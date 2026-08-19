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

# clade 投影面那半條 real-tenant-identifier 走的是 pre-commit hook，不是 full-tree audit——
# audit 的 find 清單把 template/.claude / .agents / .codex 整個 prune 掉（見 rule 的
# 「clade 投影面的覆蓋邊界」）。hook 是 source 本 script 後逐檔呼叫 check 函式，所以這裡
# 照 hook 的用法直接驗函式，而不是造 fixture 樹跑 audit（那樣永遠是 0 命中，測不到東西）。
assert_clade_projection_consumer_names() {
  local output
  output="$(
    source "${AUDIT_SCRIPT}"
    set +e
    add_finding() { printf '%s|%s\n' "$1" "$3"; }
    check_tenant_identifiers "template/.claude/rules/probe.md" "這條規約在 <consumer-b> 上實測過，另有 <consumer-b>-dev.example.com。"
    check_tenant_identifiers "template/.claude/rules/snake.md" "DB clone <consumer-b>_wt_<slug> 不存在時要 fail loud。"
    check_tenant_identifiers "template/.claude/rules/case.md" "clone 自 YUDEFINE/nuxt-supabase-starter 即可。"
    check_tenant_identifiers "template/.claude/rules/org.md" "詳見 /yudefine-deploy Phase 1-10 runbook，跑在 YuDefine LXC 的 self-hosted runner。"
    check_tenant_identifiers "template/.claude/rules/blog.md" "這條 hydration 修法在 <consumer-l> 上實測過。"
    check_tenant_identifiers "template/.claude/rules/ok.md" "這條規約在 <consumer-a> 上實測過。skill dir 是 _notion-<consumer-b>-board。"
    check_tenant_identifiers "template/docs/prose.md" "這份 root 文件提到 <consumer-b>，不在投影面範圍內。"
  )"

  if ! grep -Fq "real-tenant-identifier|template/.claude/rules/probe.md" <<< "${output}"; then
    fail "clade projection real consumer name is blocked"
  fi
  # 邊界把 `_` 當分隔字元，否則 `<consumer-b>_wt_<slug>` 這類 snake_case 洩漏會整批漏掉。
  if ! grep -Fq "real-tenant-identifier|template/.claude/rules/snake.md" <<< "${output}"; then
    fail "snake_case consumer name is blocked"
  fi
  if grep -Fq "template/.claude/rules/ok.md" <<< "${output}"; then
    fail "placeholder + _notion-<consumer-b>-board must not false-positive"
  fi
  if grep -Fq "template/docs/prose.md" <<< "${output}"; then
    fail "check must stay scoped to clade projection surfaces"
  fi
  # 例外剝除與偵測都在小寫上進行，所以 GitHub org 的大小寫變體不能誤觸。
  if grep -Fq "template/.claude/rules/case.md" <<< "${output}"; then
    fail "starter own GitHub org must not false-positive in any letter case"
  fi
  # 裸 org 名（未接 repo 名）同樣是正當引用：skill 名 `/yudefine-deploy`、`YuDefine LXC`
  # runner、`YuDefine fleet` 在投影面共 11 處，清單寫裸 `yudefine` 會把它們全判成洩漏。
  if grep -Fq "template/.claude/rules/org.md" <<< "${output}"; then
    fail "bare maintainer org must not false-positive"
  fi
  # 但 org 名開頭的**真實 consumer**（registry 內的 <consumer-l>）仍必須被擋——
  # 上一條放寬的是裸 org，不是任何以它開頭的字串。
  if ! grep -Fq "real-tenant-identifier|template/.claude/rules/blog.md" <<< "${output}"; then
    fail "consumer whose id starts with the maintainer org is still blocked"
  fi
  pass "clade projection consumer names blocked, placeholders and non-projection paths pass"
}

# check_tenant_identifiers 前兩個迴圈命中就 return，投影面那半條若掛在函式尾端會被短路。
# 同一個檔同時有非 placeholder UUID 與真實 consumer 名時，兩則 finding 都必須出現。
assert_tenant_check_does_not_short_circuit_projection() {
  local output
  output="$(
    source "${AUDIT_SCRIPT}"
    set +e
    add_finding() { printf '%s|%s|%s\n' "$1" "$3" "$2"; }
    check_tenant_identifiers "template/.claude/rules/both.md" \
      "tenant_id = \"8d2f9d4a-99b2-4dd8-99cb-f0f527c8895a\" —— 這條在 <consumer-b> 上實測過。"
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
EXPECTED_CASES=8

assert_clean_fixture
assert_private_env_fixture
assert_secret_fixture
assert_identifier_fixture
assert_starter_only_doc_fixture
assert_template_cwd_root_detection
assert_clade_projection_consumer_names
assert_tenant_check_does_not_short_circuit_projection

# 顯式且**有條件**的 exit：先前量到過「全部 ok 但 exit 127」，印出的結果與退出碼不一致的測試
# 比沒有測試更糟。這裡不寫無條件 exit 0——先核對實際 pass 數等於上面呼叫的 assert 數，
# 任何一個 case 被靜默跳過都會在這裡轉紅。另外兩條失敗路徑（斷言失敗走 fail() 的 exit 1、
# cleanup 失敗走 trap 內的 exit 1）都不經過這裡。
if [[ ${passed_count} -ne ${EXPECTED_CASES} ]]; then
  fail "expected ${EXPECTED_CASES} assertions to pass, got ${passed_count}"
fi

printf 'All %d audit-template-hygiene fixture cases passed.\n' "${passed_count}"
exit 0
