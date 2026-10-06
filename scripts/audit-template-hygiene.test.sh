#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_SCRIPT="${SCRIPT_DIR}/audit-template-hygiene.sh"

tmp_root=""

cleanup() {
  if [[ -n "${tmp_root}" && -d "${tmp_root}" ]]; then
    # trap 內失敗必須自己出聲：結尾的顯式 `exit 0` 會蓋掉 trap 留下的 status，
    # 靜默的 cleanup 失敗就會變成「看起來全綠」。
    rm -rf "${tmp_root}" || {
      printf 'not ok - cleanup failed to remove %s\n' "${tmp_root}" >&2
      exit 1
    }
  fi
}
trap cleanup EXIT

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

passed_count=0

pass() {
  printf 'ok - %s\n' "$1"
  passed_count=$((passed_count + 1))
}

write_rule() {
  local root="$1"

  mkdir -p "${root}/.claude/rules"
  cat > "${root}/.claude/rules/starter-hygiene.md" <<'RULE'
# Starter Hygiene

- `private-env-file`
- `secret-like-content`
- `real-email-identifier`
- `real-tenant-identifier`
- `unmarked-starter-only-doc`
- `dogfood-business-code`
- `dogfood-schema-hint`
- `maintenance-script-misplacement`
RULE
}

new_fixture() {
  local name="$1"
  local root="${tmp_root}/${name}"

  mkdir -p "${root}/template/docs" "${root}/template/server" "${root}/template/supabase/migrations"
  write_rule "${root}"
  git -C "${root}" init -q
  cat > "${root}/template/docs/README.md" <<'DOC'
# Starter Docs

Use user@example.com and 00000000-0000-0000-0000-000000000000 as placeholders.
DOC
  printf '%s\n' "${root}"
}

run_audit() {
  local root="$1"
  shift

  STARTER_HYGIENE_REPO_ROOT="${root}" bash "${AUDIT_SCRIPT}" "$@"
}

assert_clean_fixture() {
  local root
  root="$(new_fixture clean)"

  if ! output="$(run_audit "${root}" 2>&1)"; then
    printf '%s\n' "${output}" >&2
    fail "clean template exits 0"
  fi

  grep -Fq "No starter hygiene findings detected" <<< "${output}" || fail "clean report includes clean summary"
  pass "clean template exits 0"
}

assert_private_env_fixture() {
  local root output status
  root="$(new_fixture private-env)"
  cat > "${root}/template/.env.local" <<'ENV'
SUPABASE_URL=https://private-project.supabase.co
ENV

  set +e
  output="$(run_audit "${root}" 2>&1)"
  status=$?
  set -e

  [[ ${status} -ne 0 ]] || fail "private env fixture exits non-zero"
  grep -Fq "[Starter Hygiene] private-env-file 不通過" <<< "${output}" || fail "private env report check name"
  grep -Fq "template/.env.local" <<< "${output}" || fail "private env report evidence"
  pass "private env fixture is blocked"
}

assert_secret_fixture() {
  local root output status
  root="$(new_fixture secret-like)"
  cat > "${root}/template/server/token.ts" <<'TS'
export const token = "Bearer abcdefghijklmnopqrstuvwxyz1234567890";
TS

  set +e
  output="$(run_audit "${root}" 2>&1)"
  status=$?
  set -e

  [[ ${status} -ne 0 ]] || fail "secret fixture exits non-zero"
  grep -Fq "[Starter Hygiene] secret-like-content 不通過" <<< "${output}" || fail "secret report check name"
  grep -Fq "Bearer token" <<< "${output}" || fail "secret report category"
  if grep -Fq "abcdefghijklmnopqrstuvwxyz1234567890" <<< "${output}"; then
    fail "secret report redacts full token"
  fi
  pass "secret-like token is blocked without full value"
}

assert_identifier_fixture() {
  local root output status
  root="$(new_fixture identifiers)"
  cat > "${root}/template/server/user.ts" <<'TS'
export const adminEmail = "owner@real-company.dev";
export const tenantId = "8d2f9d4a-99b2-4dd8-99cb-f0f527c8895a";
TS

  set +e
  output="$(run_audit "${root}" 2>&1)"
  status=$?
  set -e

  [[ ${status} -ne 0 ]] || fail "identifier fixture exits non-zero"
  grep -Fq "[Starter Hygiene] real-email-identifier 不通過" <<< "${output}" || fail "email report check name"
  grep -Fq "[Starter Hygiene] real-tenant-identifier 不通過" <<< "${output}" || fail "tenant report check name"
  pass "real email and tenant identifiers are blocked"
}

assert_starter_only_doc_fixture() {
  local root output status
  root="$(new_fixture starter-only-doc)"
  cat > "${root}/template/docs/internal.md" <<'MD'
# Internal Notes

starter-only: do not scaffold this operational note.
MD

  set +e
  output="$(run_audit "${root}" 2>&1)"
  status=$?
  set -e

  [[ ${status} -ne 0 ]] || fail "starter-only doc fixture exits non-zero"
  grep -Fq "[Starter Hygiene] unmarked-starter-only-doc 不通過" <<< "${output}" || fail "starter-only doc report check name"
  grep -Fq "template/docs/internal.md" <<< "${output}" || fail "starter-only doc report evidence"
  pass "unmarked starter-only document is blocked"
}

assert_template_cwd_root_detection() {
  local root output
  root="$(new_fixture template-cwd)"

  if ! output="$(cd "${root}/template" && bash "${AUDIT_SCRIPT}" 2>&1)"; then
    printf '%s\n' "${output}" >&2
    fail "template cwd root detection exits 0"
  fi

  grep -Fq "No starter hygiene findings detected" <<< "${output}" || fail "template cwd clean summary"
  pass "template cwd root detection scans repo template"
}

# 造 fixture 用的 salted hash 清單：與 template/scripts/public-tree-hygiene-tokens.json
# 同格式（version 2 / sha256-16 / canary + 12-bit 前綴滑窗預篩），但 token 只用合成名。
# 真名 NEVER 以明文進任何 tracked 檔（含測試），「真名 hash 命中被擋」用合成 token 驗。
write_hash_tokens() {
  local dest="$1"
  shift
  mkdir -p "$(dirname "${dest}")"
  node -e '
    const fs = require("node:fs"), crypto = require("node:crypto");
    const MASK = 0xfff, ROLL = 16777619, CANARY = "public-tree-hygiene-canary";
    const salt = "fixture-salt-0001";
    const sha = (s) => crypto.createHash("sha256").update(salt + "\0" + s).digest("hex").slice(0, 16);
    const roll = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, ROLL) + s.charCodeAt(i)) >>> 0; return h; };
    const toks = process.argv.slice(2);
    const w = toks.length ? Math.min(...toks.map((t) => t.length)) : 1;
    const entries = toks.map((t) => ({ l: t.length, p: roll(t.slice(0, w)) & MASK, h: sha(t) }))
      .sort((a, b) => a.l - b.l || a.h.localeCompare(b.h));
    const empty = { w: 1, entries: [] };
    const f = { version: 2, algo: "sha256-16", salt,
      canary: { h: sha(CANARY), r: roll(CANARY) },
      consumer: { w, entries }, personal: empty, literal: empty };
    fs.writeFileSync(process.argv[1], JSON.stringify(f, null, 2) + "\n", "utf8");
  ' "${dest}" "$@"
}

# 與 write_hash_tokens 同格式，但 consumer class 由呼叫端給 raw JSON——
# 專門造「清單毀損」fixture（空 entries、壞 entry），測掃描器 fail-closed。
write_hash_tokens_raw_consumer() {
  local dest="$1" consumer_json="$2"
  mkdir -p "$(dirname "${dest}")"
  node -e '
    const fs = require("node:fs"), crypto = require("node:crypto");
    const ROLL = 16777619, CANARY = "public-tree-hygiene-canary";
    const salt = "fixture-salt-0001";
    const sha = (s) => crypto.createHash("sha256").update(salt + "\0" + s).digest("hex").slice(0, 16);
    const roll = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, ROLL) + s.charCodeAt(i)) >>> 0; return h; };
    const empty = { w: 1, entries: [] };
    const f = { version: 2, algo: "sha256-16", salt,
      canary: { h: sha(CANARY), r: roll(CANARY) },
      consumer: JSON.parse(process.argv[2]), personal: empty, literal: empty };
    fs.writeFileSync(process.argv[1], JSON.stringify(f, null, 2) + "\n", "utf8");
  ' "${dest}" "${consumer_json}"
}

# clade 投影面那半條 real-tenant-identifier 走的是 pre-commit hook，不是 full-tree audit——
# audit 的 find 清單把 template/.claude / .agents / .codex 整個 prune 掉（見 rule 的
# 「clade 投影面的覆蓋邊界」）。hook 是 source 本 script 後逐檔呼叫 check 函式，所以這裡
# 照 hook 的用法直接驗函式，而不是造 fixture 樹跑 audit（那樣永遠是 0 命中，測不到東西）。
assert_clade_projection_consumer_names() {
  local root output
  root="$(new_fixture clade-projection)"
  # 合成 token：zzfk（4 碼，壓低 w 練多長度滑窗）、zzfakeconsumer、zz-fake-longname。
  write_hash_tokens "${root}/template/scripts/public-tree-hygiene-tokens.json" \
    zzfk zzfakeconsumer zz-fake-longname

  output="$(
    source "${AUDIT_SCRIPT}"
    STARTER_HYGIENE_REPO_ROOT="${root}"
    set +e
    add_finding() { printf '%s|%s\n' "$1" "$3"; }
    check_tenant_identifiers "template/.claude/rules/probe.md" "這條規約在 zzfakeconsumer 上實測過，另有 zzfakeconsumer-dev.example.com。"
    check_tenant_identifiers "template/.claude/rules/snake.md" "DB clone zzfakeconsumer_wt_<slug> 不存在時要 fail loud。"
    check_tenant_identifiers "template/.claude/rules/upper.md" "這條修法在 ZZFAKECONSUMER 上實測過。"
    check_tenant_identifiers "template/.claude/rules/case.md" "clone 自 YUDEFINE/nuxt-supabase-starter 即可。"
    check_tenant_identifiers "template/.claude/rules/org.md" "詳見 /yudefine-deploy Phase 1-10 runbook，跑在 YuDefine LXC 的 self-hosted runner。"
    check_tenant_identifiers "template/.claude/rules/embed.md" "xzzfakeconsumer 與 zzfakeconsumerx 都不是洩漏。"
    check_tenant_identifiers "template/.claude/rules/ok.md" "這條規約在 <consumer-b> 上實測過。skill dir 是 _notion-<consumer-b>-board，org 是 <client-a>，目錄 _notion-<client-a>-board。"
    check_tenant_identifiers "template/.claude/rules/notion.md" "全域 skill 目錄是 _notion-zzfakeconsumer-board。"
    check_tenant_identifiers "template/.claude/rules/notionpath.md" "洩漏藏在目錄名中段：_notion-a-board-zzfakeconsumer-board。"
    check_tenant_identifiers "template/docs/prose.md" "這份 root 文件提到 zzfakeconsumer，不在投影面範圍內。"
  )"

  # 真名（hash 命中的合成 token）必須被擋。
  if ! grep -Fq "real-tenant-identifier|template/.claude/rules/probe.md" <<< "${output}"; then
    fail "clade projection real consumer name is blocked"
  fi
  # 邊界把 `_` 當分隔字元，否則 `<真名>_wt_<slug>` 這類 snake_case 洩漏會整批漏掉。
  if ! grep -Fq "real-tenant-identifier|template/.claude/rules/snake.md" <<< "${output}"; then
    fail "snake_case consumer name is blocked"
  fi
  # consumer 類比對是 ASCII 不分大小寫。
  if ! grep -Fq "real-tenant-identifier|template/.claude/rules/upper.md" <<< "${output}"; then
    fail "uppercase consumer name is blocked"
  fi
  # 去識別化 placeholder 是合法投影輸出，不能誤擋——這正是 v1.13.55 被擋的形狀。
  # `<consumer-*>`／`<client-*>` 都是 sanitize 產生的 label，含它們的
  # `_notion-<label>-board` 目錄名放行。
  if grep -Fq "template/.claude/rules/ok.md" <<< "${output}"; then
    fail "placeholder + _notion-<consumer-b>-board / _notion-<client-a>-board must not false-positive"
  fi
  # `_notion-…-board` 例外只放行 placeholder label 形狀：目錄名裡出現真名 token
  # 一樣要被 hash 命中擋下，不把整個目錄名剝掉（0-A r1 Minor）。
  if ! grep -Fq "real-tenant-identifier|template/.claude/rules/notion.md" <<< "${output}"; then
    fail "real consumer name inside _notion-*-board is blocked"
  fi
  # 貪婪剝除會把 `_notion-a-board-<真名>-board` 整段吃掉；收窄後中段真名仍命中。
  if ! grep -Fq "real-tenant-identifier|template/.claude/rules/notionpath.md" <<< "${output}"; then
    fail "real consumer name in the middle of _notion-a-board-*-board is blocked"
  fi
  # 英數黏著（左右無邊界）不算洩漏——token 不是 substring 比對。
  if grep -Fq "template/.claude/rules/embed.md" <<< "${output}"; then
    fail "alnum-adjacent non-token must not false-positive"
  fi
  if grep -Fq "template/docs/prose.md" <<< "${output}"; then
    fail "check must stay scoped to clade projection surfaces"
  fi
  # 例外剝除與偵測都在小寫上進行，所以 GitHub org 的大小寫變體不能誤觸。
  if grep -Fq "template/.claude/rules/case.md" <<< "${output}"; then
    fail "starter own GitHub org must not false-positive in any letter case"
  fi
  # 裸 org 名（未接 repo 名）同樣是正當引用：`yudefine` 不是 consumer token，
  # `/yudefine-deploy`、`YuDefine LXC`、`YuDefine fleet` 都不能誤擋。
  if grep -Fq "template/.claude/rules/org.md" <<< "${output}"; then
    fail "bare maintainer org must not false-positive"
  fi
  pass "clade projection consumer names blocked, placeholders and non-projection paths pass"
}

# tokens 清單不存在時（propagate 尚未落地）這個 check 無法判定真假——fail-closed
# 回 scanner_error，而不是像上次明文清單被洗掉那樣靜默假綠。
assert_clade_projection_missing_tokens_fails_closed() {
  local root output
  root="$(new_fixture missing-tokens)"

  output="$(
    source "${AUDIT_SCRIPT}"
    STARTER_HYGIENE_REPO_ROOT="${root}"
    set +e
    add_finding() { printf '%s|%s\n' "$1" "$3"; }
    check_tenant_identifiers "template/.claude/rules/probe.md" "任意內容"
    printf 'scanner_errors=%s\n' "${scanner_errors[@]:-}"
  )"

  if grep -Fq "real-tenant-identifier|template/.claude/rules/probe.md" <<< "${output}"; then
    fail "missing tokens must not produce a finding"
  fi
  if ! grep -Fq "public-tree-hygiene-tokens.json" <<< "${output}"; then
    fail "missing tokens file fails closed with scanner error"
  fi
  pass "missing tokens file fails closed"
}

# consumer.entries 為空、或任一 entry 不符 loadTokens 的驗證（l >= w、p 在 mask 範圍、
# h 是 /^[0-9a-f]{16}$/）時掃描器一律 exit 2 → check 回 scanner_error fail-closed。
# 空清單讓這條 check 恆綠、壞 entry 代表清單被寫壞——都與缺檔同形狀（0-A r1 Minor）。
assert_clade_projection_degraded_tokens_fail_closed() {
  local root tokens output case_label consumer_json
  root="$(new_fixture degraded-tokens)"
  tokens="${root}/template/scripts/public-tree-hygiene-tokens.json"

  for case_label in empty-entries bad-entry-length bad-entry-prefix bad-entry-hash; do
    case "${case_label}" in
      empty-entries)    consumer_json='{"w":4,"entries":[]}' ;;
      bad-entry-length) consumer_json='{"w":4,"entries":[{"l":3,"p":1,"h":"0123456789abcdef"}]}' ;;
      bad-entry-prefix) consumer_json='{"w":4,"entries":[{"l":4,"p":4096,"h":"0123456789abcdef"}]}' ;;
      bad-entry-hash)   consumer_json='{"w":4,"entries":[{"l":4,"p":1,"h":"not-a-hex-hash"}]}' ;;
    esac
    write_hash_tokens_raw_consumer "${tokens}" "${consumer_json}"

    output="$(
      source "${AUDIT_SCRIPT}"
      STARTER_HYGIENE_REPO_ROOT="${root}"
      set +e
      printf 'probe zzfakeconsumer' | node -e "${CONSUMER_TOKEN_SCANNER_JS}" "${tokens}" 2>/dev/null
      printf 'scanner-exit=%s\n' "$?"
      add_finding() { printf 'finding|%s|%s\n' "$1" "$3"; }
      check_tenant_identifiers "template/.claude/rules/probe.md" "這條在 zzfakeconsumer 上實測過。"
      printf 'scanner_errors=%s\n' "${scanner_errors[@]:-}"
    )"

    if grep -Fq 'finding|' <<< "${output}"; then
      fail "${case_label}: degraded tokens must not produce a finding"
    fi
    if ! grep -Fq 'scanner-exit=2' <<< "${output}"; then
      fail "${case_label}: embedded scanner must exit 2 on degraded tokens"
    fi
    if ! grep -Fq 'consumer token scan' <<< "${output}"; then
      fail "${case_label}: degraded tokens must fail closed with scanner error"
    fi
  done

  pass "empty or malformed consumer entries fail closed"
}

# template/scripts/ 會被 scaffolder 整棵複製：維護倉專用腳本放進來一定流進使用者
# 專案（TD-008 的實例就是 validate-starter.mjs）。偵測靠內容訊號而非檔名；fixture
# 復刻搬走前的 validate-starter.mjs 形狀——解析 repo root / template root、參考
# packages/create-nuxt-starter 並把 fixture 寫進 temp/validate-starter。
assert_maintenance_script_fixture() {
  local root output status
  root="$(new_fixture maintenance-script)"
  mkdir -p "${root}/template/scripts"
  cat > "${root}/template/scripts/validate-starter.mjs" <<'MJS'
#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_ROOT = resolve(SCRIPT_DIR, '..')
const REPO_ROOT = resolve(TEMPLATE_ROOT, '..')
const FIXTURE_ROOT = join(TEMPLATE_ROOT, 'temp', 'validate-starter')
const SCAFFOLDER_DIR = join(TEMPLATE_ROOT, 'packages', 'create-nuxt-starter')
MJS

  set +e
  output="$(run_audit "${root}" 2>&1)"
  status=$?
  set -e

  [[ ${status} -ne 0 ]] || fail "maintenance script fixture exits non-zero"
  grep -Fq "[Starter Hygiene] maintenance-script-misplacement 不通過" <<< "${output}" || fail "maintenance script report check name"
  grep -Fq "template/scripts/validate-starter.mjs" <<< "${output}" || fail "maintenance script report evidence"
  pass "validate-starter-shaped maintenance script is blocked"
}

# 陰性例兩個：一是 scaffold 後仍有意義的 consumer runtime 腳本（verify-starter 的
# 形狀——以 process.cwd() 為 root，讀 sibling packages/create-nuxt-starter 只為
# 判斷 starter-self），二是帶 CLADE:VENDOR-SCRIPT 標記的投影檔（落點由 propagate
# 決定，就算內容出現 meta repo token 也輪不到這個 gate 管）。
assert_maintenance_script_negative_fixtures() {
  local root output
  root="$(new_fixture consumer-runtime-script)"
  mkdir -p "${root}/template/scripts"
  cat > "${root}/template/scripts/check-health.mjs" <<'MJS'
#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const mode = existsSync(join(ROOT, '..', 'packages', 'create-nuxt-starter'))
  ? 'starter-self'
  : 'consumer'
console.log(mode)
MJS

  if ! output="$(run_audit "${root}" 2>&1)"; then
    printf '%s\n' "${output}" >&2
    fail "consumer runtime script fixture exits 0"
  fi

  root="$(new_fixture vendored-projection-script)"
  mkdir -p "${root}/template/scripts"
  cat > "${root}/template/scripts/vendored-probe.ts" <<'TS'
// CLADE:VENDOR-SCRIPT — maintained in clade, projected into consumers.
const TEMPLATE_ROOT = new URL('../../template/', import.meta.url).pathname
export const probeRoot = TEMPLATE_ROOT
TS

  if ! output="$(run_audit "${root}" 2>&1)"; then
    printf '%s\n' "${output}" >&2
    fail "CLADE:VENDOR-SCRIPT fixture exits 0"
  fi

  # 小寫 template_root / fixture_root 是 consumer 腳本指自己範本目錄的合法命名——
  # meta 路徑 token 採大小寫敏感比對後不得誤擋（0-A r1 Minor #3）。
  root="$(new_fixture consumer-lowercase-roots)"
  mkdir -p "${root}/template/scripts"
  cat > "${root}/template/scripts/render-site.mjs" <<'MJS'
#!/usr/bin/env node
import { join } from 'node:path'

const template_root = join(process.cwd(), 'templates')
const fixture_root = join(template_root, 'fixtures')
console.log(fixture_root)
MJS

  if ! output="$(run_audit "${root}" 2>&1)"; then
    printf '%s\n' "${output}" >&2
    fail "lowercase template_root/fixture_root consumer script exits 0"
  fi

  pass "consumer runtime script, CLADE:VENDOR-SCRIPT marker and lowercase *_root names stay clean"
}

# check_tenant_identifiers 前兩個迴圈命中就 return，投影面那半條若掛在函式尾端會被短路。
# 同一個檔同時有非 placeholder UUID 與真實 consumer 名時，兩則 finding 都必須出現。
assert_tenant_check_does_not_short_circuit_projection() {
  local root output
  root="$(new_fixture tenant-short-circuit)"
  write_hash_tokens "${root}/template/scripts/public-tree-hygiene-tokens.json" \
    zzfakeconsumer

  output="$(
    source "${AUDIT_SCRIPT}"
    STARTER_HYGIENE_REPO_ROOT="${root}"
    set +e
    add_finding() { printf '%s|%s|%s\n' "$1" "$3" "$2"; }
    check_tenant_identifiers "template/.claude/rules/both.md" \
      "tenant_id = \"8d2f9d4a-99b2-4dd8-99cb-f0f527c8895a\" —— 這條在 zzfakeconsumer 上實測過。"
  )"

  if ! grep -Fq "non-placeholder UUID pattern" <<< "${output}"; then
    fail "UUID finding still reported"
  fi
  if ! grep -Fq "real consumer identifier category" <<< "${output}"; then
    fail "projection finding not short-circuited by UUID finding"
  fi
  pass "UUID finding does not short-circuit clade projection finding"
}

[[ -x "${AUDIT_SCRIPT}" || -f "${AUDIT_SCRIPT}" ]] || fail "audit script exists"

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/starter-hygiene-test.XXXXXX")"

# 下面每加一個 assert_* 呼叫就 +1；結尾用它核對沒有 case 被靜默跳過。
EXPECTED_CASES=12

assert_clean_fixture
assert_private_env_fixture
assert_secret_fixture
assert_identifier_fixture
assert_starter_only_doc_fixture
assert_template_cwd_root_detection
assert_clade_projection_consumer_names
assert_clade_projection_missing_tokens_fails_closed
assert_clade_projection_degraded_tokens_fail_closed
assert_tenant_check_does_not_short_circuit_projection
assert_maintenance_script_fixture
assert_maintenance_script_negative_fixtures

# 顯式且**有條件**的 exit：先前量到過「全部 ok 但 exit 127」，印出的結果與退出碼不一致的測試
# 比沒有測試更糟。這裡不寫無條件 exit 0——先核對實際 pass 數等於上面呼叫的 assert 數，
# 任何一個 case 被靜默跳過都會在這裡轉紅。另外兩條失敗路徑（斷言失敗走 fail() 的 exit 1、
# cleanup 失敗走 trap 內的 exit 1）都不經過這裡。
if [[ ${passed_count} -ne ${EXPECTED_CASES} ]]; then
  fail "expected ${EXPECTED_CASES} assertions to pass, got ${passed_count}"
fi

printf 'All %d audit-template-hygiene fixture cases passed.\n' "${passed_count}"
exit 0
