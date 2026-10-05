#!/usr/bin/env bash
set -euo pipefail

REQUIRED_CHECKS=(
  private-env-file
  secret-like-content
  real-email-identifier
  real-tenant-identifier
  unmarked-starter-only-doc
  dogfood-business-code
  dogfood-schema-hint
  maintenance-script-misplacement
)

AUDIT_CHECKS=(
  private-env-file
  secret-like-content
  real-email-identifier
  real-tenant-identifier
  unmarked-starter-only-doc
  dogfood-business-code
  dogfood-schema-hint
  maintenance-script-misplacement
)

# clade 投影面的真實 consumer 名比對（check_clade_projection_consumer_names）。
# check_dogfood_business_code 有另一份**刻意不同**的清單，理由寫在該函式上方。
#
# 明文真名清單不能存在於這個 public repo——清單本身就是客戶名單。2026-10-03 的
# history rewrite 把舊 CONSUMER_NAMES 洗成 `<consumer-b>|...` placeholder 之後，這個
# check 雙向失效：只命中去識別化 placeholder（誤判）、永遠抓不到真名（漏抓）。
#
# 正確機制 repo 裡已經有：clade propagate 產生的 salted hash 清單
# `template/scripts/public-tree-hygiene-tokens.json`（與投影檔
# template/scripts/audit-public-tree-hygiene.ts 同一份實作語義：sha256-16 全 token
# 比對 + 12-bit 前綴滑窗預篩；consumer 類 token 左右邊界為非英數、ASCII 不分大小寫，
# `_` / `-` 都算邊界）。hash 清單不明文、不怕 history rewrite。
#
# 本檔內嵌同等掃描，而不是直接跑投影的 audit .ts：(a) 這個 check 要的是「單一
# staged blob」判定，--staged 掃的是整個 index、還帶 personal/literal 兩類，語義
# 不同層；(b) 例外剝除（_notion-*-board、yudefine/nuxt-supabase-starter）要在掃描前
# 對 blob 進行；(c) 只依賴 tokens 清單落地，不依賴投影 .ts 檔存在。清單缺失或毀損
# （含 canary 不符＝hash 語義漂移）一律 scanner_error fail-closed——沒有清單等於
# 沒有 gate，這正是上次靜默失效的形狀。
#
# 掃描器 exit：0 無命中 / 1 consumer token 命中 / 2 清單或環境錯誤。
# 由 stdin 餵入已小寫、已剝例外的文字（path + blob）。
CONSUMER_TOKEN_SCANNER_JS='
const fs = require("node:fs");
const crypto = require("node:crypto");
const MASK = 0x0fff;
const ROLL = 16777619;
const CANARY = "public-tree-hygiene-canary";
const die = (msg) => {
  process.stderr.write("consumer-token-scan: " + msg + "\n");
  process.exit(2);
};
const tokensPath = process.argv[1];
if (!tokensPath) die("missing tokens path argument");
let f;
try {
  f = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
} catch (err) {
  die("cannot load tokens file: " + err.message);
}
if (!f || f.version !== 2 || f.algo !== "sha256-16") die("tokens version/algo mismatch");
if (typeof f.salt !== "string" || f.salt.length < 8) die("tokens salt missing");
const sha = (s) => crypto.createHash("sha256").update(f.salt + "\0" + s).digest("hex").slice(0, 16);
const roll = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, ROLL) + s.charCodeAt(i)) >>> 0;
  return h;
};
if (!f.canary || f.canary.h !== sha(CANARY) || f.canary.r !== roll(CANARY)) die("canary mismatch");
const cls = f.consumer;
if (!cls || !Number.isInteger(cls.w) || !Array.isArray(cls.entries)) die("consumer class malformed");
let text;
try {
  text = fs.readFileSync(0, "utf8");
} catch (err) {
  die("cannot read stdin: " + err.message);
}
const n = text.length;
let hit = false;
if (cls.entries.length > 0 && cls.w > 0 && cls.w <= n) {
  const w = cls.w;
  const bitmap = new Uint8Array(MASK + 1);
  const byPrefix = new Map();
  for (const e of cls.entries) {
    let arr = byPrefix.get(e.p);
    if (!arr) byPrefix.set(e.p, (arr = []));
    arr.push(e);
    bitmap[e.p] = 1;
  }
  let pow = 1;
  for (let k = 1; k < w; k++) pow = Math.imul(pow, ROLL);
  const lowerAscii = (s) => s.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
  const alnum = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  const codes = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const ch = text.charCodeAt(i);
    codes[i] = ch >= 65 && ch <= 90 ? ch + 32 : ch;
  }
  let h = 0;
  for (let k = 0; k < w; k++) h = (Math.imul(h, ROLL) + codes[k]) | 0;
  for (let i = 0; ; i++) {
    if (bitmap[h & MASK] === 1) {
      const cands = byPrefix.get(h & MASK);
      if (cands && (i === 0 || !alnum(codes[i - 1]))) {
        for (const c of cands) {
          if (i + c.l > n) continue;
          if (i + c.l < n && alnum(codes[i + c.l])) continue;
          if (c.h === sha(lowerAscii(text.slice(i, i + c.l)))) { hit = true; break; }
        }
      }
    }
    if (hit || i + w >= n) break;
    h = (Math.imul((h - Math.imul(codes[i], pow)) | 0, ROLL) + codes[i + w]) | 0;
  }
}
process.exit(hit ? 1 : 0);
'

finding_checks=()
finding_problems=()
finding_evidence=()
finding_fixes=()
finding_bypasses=()
scanner_errors=()
repo_root_override="${STARTER_HYGIENE_REPO_ROOT:-}"

usage() {
  cat <<'USAGE'
Usage: audit-template-hygiene.sh [--repo-root <path>]

Scans the full template/ tree for starter hygiene findings.
Exit 0 means clean. Non-zero means findings or scanner errors.
USAGE
}

add_finding() {
  local check_name="$1"
  local problem="$2"
  local evidence="$3"
  local fix="$4"
  local bypass="$5"

  finding_checks+=("${check_name}")
  finding_problems+=("${problem}")
  finding_evidence+=("${evidence}")
  finding_fixes+=("${fix}")
  finding_bypasses+=("${bypass}")
}

scanner_error() {
  scanner_errors+=("$1 | $2")
}

contains_item() {
  local needle="$1"
  shift
  local item

  for item in "$@"; do
    [[ "${item}" == "${needle}" ]] && return 0
  done

  return 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo-root)
        if [[ $# -lt 2 || -z "${2:-}" ]]; then
          scanner_error "缺少 --repo-root 參數值。" "--repo-root"
          return 1
        fi
        repo_root_override="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        scanner_error "不支援的參數。" "$1"
        return 1
        ;;
    esac
  done
}

resolve_repo_root() {
  local root

  if [[ -n "${repo_root_override}" ]]; then
    if root="$(cd "${repo_root_override}" 2>/dev/null && pwd -P)"; then
      printf '%s\n' "${root}"
      return 0
    fi

    scanner_error "無法定位指定的 repo root override。" "${repo_root_override}"
    return 1
  fi

  if root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    root="$(cd "${root}" 2>/dev/null && pwd -P)" || {
      scanner_error "無法切換到 git repo root。" "${root}"
      return 1
    }
    printf '%s\n' "${root}"
    return 0
  fi

  scanner_error "無法定位 git repo root；請從 repo root/template 執行或傳入 --repo-root。" "git rev-parse --show-toplevel"
  return 1
}

verify_check_names() {
  local root="$1"
  local rule_path="${root}/.claude/rules/starter-hygiene.md"
  local check_name

  if [[ ${#AUDIT_CHECKS[@]} -ne ${#REQUIRED_CHECKS[@]} ]]; then
    scanner_error "audit check name 數量與 rule 預期不一致，為避免 hygiene drift 採 fail-closed。" "audit check list"
    return 1
  fi

  if [[ ! -f "${rule_path}" ]]; then
    scanner_error "找不到 root starter hygiene rule，無法確認 audit check names 是否對齊。" "${rule_path}"
    return 1
  fi

  for check_name in "${REQUIRED_CHECKS[@]}"; do
    if ! contains_item "${check_name}" "${AUDIT_CHECKS[@]}"; then
      scanner_error "audit script 缺少 Phase A 定義的 check name，為避免靜默污染採 fail-closed。" "missing check: ${check_name}"
      return 1
    fi

    if ! grep -Fq -- "${check_name}" "${rule_path}"; then
      scanner_error "rule 與 audit check name 對不上，為避免 hygiene drift 採 fail-closed。" "${rule_path} + ${check_name}"
      return 1
    fi
  done

  return 0
}

is_placeholder_value() {
  local value="$1"
  local normalized

  normalized="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  normalized="${normalized%\"}"
  normalized="${normalized#\"}"
  normalized="${normalized%\'}"
  normalized="${normalized#\'}"

  [[ -z "${normalized}" ]] && return 0
  [[ "${normalized}" =~ ^(\$|\$\{|<|\{) ]] && return 0
  [[ "${normalized}" =~ ^(true|false|null|none|dev|development|test|testing|local|public|anon|0|1|3000|5432)$ ]] && return 0
  [[ "${normalized}" == *"your_"* || "${normalized}" == *"your-"* ]] && return 0
  [[ "${normalized}" == *"example"* || "${normalized}" == *"placeholder"* ]] && return 0
  [[ "${normalized}" == *"changeme"* || "${normalized}" == *"change_me"* || "${normalized}" == *"replace"* ]] && return 0
  [[ "${normalized}" == *"xxxxx"* || "${normalized}" == *"xxxx"* || "${normalized}" == *"sk-xxxxx"* ]] && return 0
  [[ "${normalized}" == *"localhost"* || "${normalized}" == *"127.0.0.1"* || "${normalized}" == *"0.0.0.0"* ]] && return 0
  [[ "${normalized}" == *"demo"* || "${normalized}" == *"sample"* || "${normalized}" == *"acme"* ]] && return 0
  [[ "${normalized}" == *"c3vwywjhc2utzgvtby"* ]] && return 0
  [[ "${normalized}" == "00000000-0000-0000-0000-000000000000" ]] && return 0
  [[ "${normalized}" == "550e8400-e29b-41d4-a716-446655440000" ]] && return 0

  return 1
}

check_private_env_path() {
  local path="$1"

  if [[ "${path}" == "template/.env" || "${path}" == "template/.env.local" || "${path}" == */.env || "${path}" == */.env.local ]]; then
    add_finding \
      "private-env-file" \
      "私人環境檔不能進入會被 scaffold 帶走的 template tree。" \
      "${path} + private env path" \
      "移除該檔；若使用者需要設定範本，改用 template/.env.example 並只保留 placeholder。" \
      "只有在 plan package / PR / commit context 記錄此檔為刻意保留且已去識別化後，才允許維護者明示 bypass。"
  fi
}

check_env_example_values() {
  local path="$1"
  local blob="$2"
  local line key value

  [[ "${path}" == "template/.env.example" || "${path}" == */.env.example ]] || return 0

  while IFS= read -r line; do
    [[ "${line}" =~ ^[[:space:]]*$ || "${line}" =~ ^[[:space:]]*# ]] && continue
    line="${line#export }"
    [[ "${line}" == *"="* ]] || continue

    key="${line%%=*}"
    value="${line#*=}"
    key="$(printf '%s' "${key}" | tr '[:lower:]' '[:upper:]')"

    if [[ "${key}" =~ ^SUPABASE_.*KEY$ && "${value}" == eyJ* ]]; then
      continue
    fi

    if [[ "${key}" =~ (KEY|TOKEN|SECRET|PASSWORD|DATABASE|DSN|URL|SUPABASE|OPENAI|RESEND|STRIPE|SLACK|JWT|AUTH) ]] && ! is_placeholder_value "${value}"; then
      add_finding \
        "private-env-file" \
        ".env.example 只能保留 placeholder；敏感設定不能放入看似真實的值。" \
        "${path} + .env.example non-placeholder value category" \
        "把值改成 your_value_here、example、sk-xxxxx、localhost 或其他明確 placeholder。" \
        "只有在 plan package / PR / commit context 記錄該值是去識別化範例後，才允許維護者明示 bypass。"
      return 0
    fi
  done <<< "${blob}"
}

check_secret_like_content() {
  local path="$1"
  local blob="$2"
  local category=""

  if grep -Eq -- '(^|[^[:alnum:]_])sk-[A-Za-z0-9_-]{20,}' <<< "${blob}"; then
    category="API key prefix"
  elif grep -Eq -- 'Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{20,}' <<< "${blob}"; then
    category="Bearer token"
  elif grep -Eq -- 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' <<< "${blob}" && ! { [[ "${path}" == *.env.example || "${path}" == *.env.test ]] || grep -Eiq -- '(supabase|service_role|anon)' <<< "${blob}"; }; then
    category="JWT-shaped token"
  elif grep -Eq -- 'https://hooks\.slack\.com/services/[A-Za-z0-9/_-]+' <<< "${blob}"; then
    category="Slack webhook URL"
  elif grep -Eq -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' <<< "${blob}"; then
    category="private key block"
  elif grep -Eq -- '(^|[^A-Z0-9])(AKIA[0-9A-Z]{16})([^A-Z0-9]|$)' <<< "${blob}"; then
    category="AWS access key id"
  elif grep -Eq -- 'AIza[0-9A-Za-z_-]{35}' <<< "${blob}"; then
    category="Google API key prefix"
  fi

  if [[ -n "${category}" ]]; then
    add_finding \
      "secret-like-content" \
      "template content 含疑似 secret，不能進入 starter seed。" \
      "${path} + ${category}" \
      "移除 secret，改用 placeholder，並保留去識別化後的內容。" \
      "只有在 plan package / PR / commit context 記錄此值是無效範例且已去識別化後，才允許維護者明示 bypass。"
  fi
}

check_email_identifiers() {
  local path="$1"
  local blob="$2"
  local email domain

  while IFS= read -r email; do
    [[ -z "${email}" ]] && continue
    domain="$(printf '%s' "${email##*@}" | tr '[:upper:]' '[:lower:]')"

    # `name@view.vue` / `child@sidebar.vue`（Nuxt 具名 view）、`pkg@1.2.3` 等寫法都會命中
    # email regex，但 @ 右側是檔名／副檔名而不是 domain。以副檔名結尾就不是 email。
    case "${domain}" in
      *.vue|*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.md|*.json|*.yml|*.yaml|*.css|*.scss|*.sql|*.sh|*.py|*.toml)
        continue
        ;;
    esac

    case "${domain}" in
      # dev.local：clade 投影規約引用的 dev-login fixture domain（e2e-<role>@dev.local）。
      # 那是 review-gui `extractDevLoginIdentity` 實際比對的命名慣例，不是真人 email。
      example.com|example.org|example.net|example.test|*.example.com|localhost|localhost.local|test.local|dev.local|invalid.test|test.com|email.com)
        continue
        ;;
    esac
    [[ "${email}" == git@github.com || "${email}" == noreply@anthropic.com || "${email}" == *"xxx@"* ]] && continue

    add_finding \
      "real-email-identifier" \
      "template content 含非 placeholder email，可能把可識別使用者資料帶進 starter。" \
      "${path} + email address pattern" \
      "改用 user@example.com、admin@example.test 或其他明確範例 domain。" \
      "只有在 plan package / PR / commit context 記錄該 email 為去識別化範例後，才允許維護者明示 bypass。"
    return 0
  done < <(grep -Eio -- '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' <<< "${blob}" || true)
}

check_tenant_identifiers() {
  local path="$1"
  local blob="$2"
  local uuid line lowered

  # 先跑投影面那半條：下面兩個迴圈命中就 `return 0`，掛在函式尾端會被短路——
  # 同一個檔同時有非 placeholder UUID 與真實 consumer 名時，報告會漏掉後者。
  check_clade_projection_consumer_names "${path}" "${blob}"

  while IFS= read -r uuid; do
    [[ -z "${uuid}" ]] && continue
    if [[ "${uuid}" != "00000000-0000-0000-0000-000000000000" && "${uuid}" != "550e8400-e29b-41d4-a716-446655440000" ]]; then
      add_finding \
        "real-tenant-identifier" \
        "template content 含非 placeholder UUID，可能對應真實 tenant / org / user。" \
        "${path} + non-placeholder UUID pattern" \
        "改用 00000000-0000-0000-0000-000000000000、demo-tenant 或 example-org。" \
        "只有在 plan package / PR / commit context 記錄該 identifier 為去識別化範例後，才允許維護者明示 bypass。"
      return 0
    fi
  done < <(grep -Eio -- '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' <<< "${blob}" || true)

  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    lowered="$(printf '%s' "${line}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${lowered}" == *"example"* || "${lowered}" == *"placeholder"* || "${lowered}" == *"your_"* || "${lowered}" == *"your-"* || "${lowered}" == *"demo"* || "${lowered}" == *"sample"* || "${lowered}" == *"acme"* || "${lowered}" == *"test"* || "${lowered}" == *"my-"* || "${lowered}" == *"00000000"* ]]; then
      continue
    fi

    add_finding \
      "real-tenant-identifier" \
      "template content 含疑似真實 tenant / org / customer identifier。" \
      "${path} + tenant identifier assignment pattern" \
      "改用 demo-tenant、example-org、零值 UUID，或移到 template/.examples/ 並去識別化。" \
      "只有在 plan package / PR / commit context 記錄該 identifier 為去識別化範例後，才允許維護者明示 bypass。"
    return 0
  done < <(grep -Ei -- '(tenant|organization|org|customer|company)[_-]?(id|slug|key|name)?[[:space:]]*[:=][[:space:]]*["'\''][A-Za-z0-9][A-Za-z0-9._-]{5,}["'\'']' <<< "${blob}" || true)
}

# clade 投影面的真實 consumer 名。
#
# 上面兩段比對的是 UUID 與 `tenant_id = "..."` 這類 assignment 形狀，對散文裡直接寫出的
# consumer 名零訊號。而 template/package.json 的 postinstall 一旦在本 repo 內觸發 clade
# bootstrap，寫回來的正是散文——投影規約整篇引用真實 consumer 當實證來源（TD-006；
# 2026-08-19 commit eae5091 帶進 221 行）。check_dogfood_business_code 接不到它：那支對
# 含 `LOCKED` + `managed by clade` 的檔直接 return，而 clade 投影全中。
check_clade_projection_consumer_names() {
  local path="$1"
  local blob="$2"
  local sanitized root tokens_path scan_status

  case "${path}" in
    template/.claude/*|template/.agents/*|template/.codex/*|template/AGENTS.md|template/CLAUDE.md) ;;
    *) return 0 ;;
  esac

  # tokens 清單由 clade propagate 寫進 template/scripts/；repo root 判定順序與
  # resolve_repo_root 相同（env override → git toplevel），但要在函式被 source 後的
  # 呼叫當下才解析——測試會在同一個 sourced shell 裡切不同 fixture root。
  root="${STARTER_HYGIENE_REPO_ROOT:-${repo_root_override:-}}"
  if [[ -z "${root}" ]]; then
    root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  fi

  tokens_path="${root:+${root}/}template/scripts/public-tree-hygiene-tokens.json"
  if [[ -z "${root}" || ! -f "${tokens_path}" ]]; then
    scanner_error \
      "clade 投影面 consumer 比對缺 salted hash 清單（由 propagate 產生），沒有清單等於沒有 gate，採 fail-closed。" \
      "${tokens_path}"
    return 0
  fi

  # 先統一小寫再剝例外：掃描器對 consumer 類本來就是 ASCII 不分大小寫，剝與比對的
  # 大小寫語義必須一致（`YUDEFINE/nuxt-supabase-starter` 這類變體才剝得掉）。
  # 剝掉兩種已知的非 consumer-identity 出現（hub-agnostic，不含任何明文真名）：
  #   `_notion-<名>-board`                  全域 skill 的目錄名，任何 consumer 都可能有一份
  #   `yudefine/nuxt-supabase-starter`      發佈本 starter 的 GitHub org + repo，正當引用
  # 用 tr 而非 ${blob,,}：後者是 bash 4+ 專屬，macOS 內建 bash 3.2 會 bad substitution，
  # 而本檔另外三處小寫化本來就走 tr。
  sanitized="$(printf '%s\n%s' "${path}" "${blob}" | tr '[:upper:]' '[:lower:]')"
  sanitized="$(printf '%s' "${sanitized}" | sed -E 's/_notion-[a-z0-9._<>-]+-board//g')"
  sanitized="${sanitized//yudefine\/nuxt-supabase-starter/}"

  # 邊界刻意只把英數算成識別字——`-` 與 `_` 都要當分隔字元，這與 clade sanitizeText 的
  # `(?<![a-z0-9])TOKEN(?![a-z0-9])` 同語義：`<真名>-dev.<domain>`、`gh-runner-<真名>`、
  # `<真名>_wt_<slug>` 全是真實洩漏，任一符號留在邊界類別裡都會放掉它們。
  scan_status=0
  printf '%s' "${sanitized}" | node -e "${CONSUMER_TOKEN_SCANNER_JS}" "${tokens_path}" || scan_status=$?

  case "${scan_status}" in
    0) ;;
    1)
      add_finding \
        "real-tenant-identifier" \
        "clade 投影面含真實 consumer 名，代表投影未去識別化（多半是 bootstrap 在本 repo 內跑過）。" \
        "${path} + real consumer identifier category" \
        "改用 <consumer-a> 這類去識別化 placeholder；若是 bootstrap 產物，先確認 template/package.json 的 postinstall self-detection 生效再重投影。" \
        "只有在 plan package / PR / commit context 記錄該名稱為刻意保留後，才允許維護者明示 bypass。"
      ;;
    *)
      scanner_error \
        "consumer token 掃描器錯誤（exit ${scan_status}），starter hygiene 採 fail-closed。" \
        "${path} + consumer token scan"
      ;;
  esac
}

check_starter_only_docs() {
  local path="$1"
  local blob="$2"

  [[ "${path}" == *.md ]] || return 0
  [[ "${path}" == template/.claude/* || "${path}" == template/.agents/* || "${path}" == template/.codex/* ]] && return 0
  [[ "${path}" == template/docs/decisions/* || "${path}" == template/docs/rules/* ]] && return 0
  [[ "${path}" == template/.examples/* || "${path}" == template/.starter/* || "${path}" == *.starter.md ]] && return 0

  if grep -Eiq -- '(starter-only|internal-only|do not scaffold|dogfood)' <<< "${blob}"; then
    add_finding \
      "unmarked-starter-only-doc" \
      "一般 starter 文件含 starter-only / internal-only 標記文字，但檔案路徑未明確標記。" \
      "${path} + starter-only marker category" \
      "改名為 *.starter.md，或移入 template/.starter/ / template/.examples/。" \
      "只有在 plan package / PR / commit context 記錄為刻意保留且路徑已補標記後，才允許維護者明示 bypass。"
  fi
}

check_dogfood_business_code() {
  local path="$1"
  local blob="$2"

  if grep -Fq -- "LOCKED" <<< "${blob}" && grep -Fq -- "managed by clade" <<< "${blob}"; then
    return 0
  fi

  # 這份清單刻意**不**共用投影面那套 consumer token 比對：`yudefine` 是發佈本 starter 的 GitHub org，
  # 在 template/app/** 的 clone URL 與 docs 連結裡是正當出現（`(home).vue` 就有兩處），
  # 併進來會把 starter 自己的首頁判成 dogfood 污染。
  if [[ "${path}" =~ ^template/(app/pages|app/components|server|supabase|tests|test)/ ]] && grep -Eiq -- '(dogfood|<consumer-d>|<consumer-d>|<consumer-b>|<consumer-a>|procurement|workstation|inspection_equipment|school[-_]window)' <<< "${blob}"; then
    add_finding \
      "dogfood-business-code" \
      "template content 含 dogfood / business-specific keyword，不能污染 scaffold seed。" \
      "${path} + business-specific keyword category" \
      "移到 root docs / examples / playground，或另開 change 設計為 starter-safe 範例。" \
      "只有在 plan package / PR / commit context 記錄該內容是去識別化 starter 範例後，才允許維護者明示 bypass。"
  fi
}

check_dogfood_schema_hint() {
  local path="$1"
  local blob="$2"

  [[ "${path}" == template/supabase/* ]] || return 0

  if grep -Eiq -- '(tenant[-_ ]specific|tenant_schema|private seed|real tenant|customer_id|organization_id|tenant_id)' <<< "${blob}"; then
    add_finding \
      "dogfood-schema-hint" \
      "template Supabase schema / seed 含 tenant-specific 或 private seed hint。" \
      "${path} + dogfood schema hint category" \
      "改成通用 starter schema；業務範例移到 template/.examples/ 並去識別化。" \
      "只有在 plan package / PR / commit context 記錄該 schema hint 是 starter-safe 範例後，才允許維護者明示 bypass。"
  fi
}

check_maintenance_script_misplacement() {
  local path="$1"
  local blob="$2"

  [[ "${path}" == template/scripts/* ]] || return 0

  # clade vendor 投影不是 starter 自己誤放的維護腳本——它落在哪由 propagate 決定，
  # 且 smoke-scaffold.sh 已明確把它排除在 scaffold 產物之外，不會流進使用者專案。
  # 判準用源檔自帶的標記，不用路徑或檔名猜。
  if grep -Fq -- "CLADE:VENDOR-SCRIPT" <<< "${blob}"; then
    return 0
  fi

  # 內容訊號分兩層。單字命中的是只有維護腳本會參考的 meta repo 佈局：
  # TEMPLATE_ROOT / FIXTURE_ROOT / temp/validate-starter——scaffold 出去的專案沒有
  # template/ 這層，consumer runtime 腳本不會出現它們（validate-starter.mjs 搬走前
  # 三個全中）。REPO_ROOT 與 create-nuxt-starter 各自都有正當 consumer 用法——
  # templates/vite-hooks/pre-commit 的 _REPO_ROOT 指 consumer 自己的 repo 根、
  # verify-starter.mjs 讀 sibling packages/create-nuxt-starter 判斷 starter-self——
  # 只有兩者同時出現（解析 repo root 又參考 scaffolder package）才算維護用途。
  # 大寫 meta 路徑 token 用大小寫敏感比對：consumer 腳本裡 `template_root`／`fixture_root`
  # 是指向自己範本目錄的合法命名，不分大小寫會把正常 runtime 腳本誤擋。
  if grep -Eiq -- '(starter hygiene|sync-to-agents|create-clean|scaffolder maintenance)' <<< "${blob}" \
    || grep -Eq -- '(TEMPLATE_ROOT|FIXTURE_ROOT|temp/validate-starter)' <<< "${blob}" \
    || { grep -Fq -- 'REPO_ROOT' <<< "${blob}" && grep -Fq -- 'create-nuxt-starter' <<< "${blob}"; }; then
    add_finding \
      "maintenance-script-misplacement" \
      "root 維護腳本或 scaffolder tooling 不應放進會被 scaffold 帶走的 template/scripts/。" \
      "${path} + maintenance script category" \
      "移到 repo root scripts/；template/scripts/ 只保留 scaffold 後專案會用到的腳本。" \
      "只有在 plan package / PR / commit context 記錄該 script 是使用者專案 runtime 需要後，才允許維護者明示 bypass。"
  fi
}

is_text_file() {
  local file="$1"

  [[ ! -s "${file}" ]] && return 0
  LC_ALL=C grep -Iq . "${file}" 2>/dev/null
}

# `.cursor/` 自 clade 的 sync-to-cursor 上線後是 `.claude/` 的**生成投影**，內容逐位元
# 來自同一個來源。對投影掃、對來源不掃，會得到一個互相矛盾的結果：同一份 vendored
# skill 文件（例：vueuse-functions 的 useJwt.md 內含 JWT 形狀的範例 token）放在
# `.claude/skills/` 是通過的、投影到 `.cursor/skills/` 就擋 commit。
#
# 所以：**投影檔只在「來源檔存在」時跳過**。來源不存在就照掃 —— 那代表它不是投影，
# 是有人手寫進 `.cursor/` 的東西，正是這個 gate 該攔的。
# NEVER 改成無條件跳過整個 `.cursor/`：那會開一個「把東西寫進投影目錄就免掃」的洞。
is_projection_of_scanned_source() {
  local path="$1"
  local root="${2:-.}"
  local source_path

  case "${path}" in
    template/.cursor/*) source_path="template/.claude/${path#template/.cursor/}" ;;
    *) return 1 ;;
  esac

  [[ -f "${root}/${source_path}" ]]
}

scan_file() {
  local root="$1"
  local abs_path="$2"
  local path blob

  if [[ "${abs_path}" != "${root}/"* ]]; then
    scanner_error "掃描檔案不在 repo root 內，停止信任該路徑。" "${abs_path}"
    return 0
  fi

  path="${abs_path#"${root}/"}"

  check_private_env_path "${path}"

  case "${path}" in
    template/pnpm-lock.yaml|template/package-lock.json|template/yarn.lock|template/bun.lockb)
      return 0
      ;;
  esac

  if is_projection_of_scanned_source "${path}" "${root}"; then
    return 0
  fi

  if [[ ! -r "${abs_path}" ]]; then
    scanner_error "無法讀取 template 檔案，starter hygiene audit 採 fail-closed。" "${path}"
    return 0
  fi

  if ! is_text_file "${abs_path}"; then
    return 0
  fi

  if ! blob="$(< "${abs_path}")"; then
    scanner_error "讀取 template 檔案內容失敗，starter hygiene audit 採 fail-closed。" "${path}"
    return 0
  fi

  check_env_example_values "${path}" "${blob}"
  check_secret_like_content "${path}" "${blob}"
  check_email_identifiers "${path}" "${blob}"
  check_tenant_identifiers "${path}" "${blob}"
  check_starter_only_docs "${path}" "${blob}"
  check_dogfood_business_code "${path}" "${blob}"
  check_dogfood_schema_hint "${path}" "${blob}"
  check_maintenance_script_misplacement "${path}" "${blob}"
}

scan_template_tree() {
  local root="$1"
  local template_dir="${root}/template"
  local path candidates ignored

  if [[ ! -d "${template_dir}" ]]; then
    scanner_error "找不到 template/ 目錄，無法執行 full-tree hygiene audit。" "${template_dir}"
    return 1
  fi

  candidates="$(mktemp "${TMPDIR:-/tmp}/starter-hygiene-cand.XXXXXX")" || {
    scanner_error "無法建立暫存檔，full-tree audit 採 fail-closed。" "mktemp candidates"
    return 1
  }
  ignored="$(mktemp "${TMPDIR:-/tmp}/starter-hygiene-ignored.XXXXXX")" || {
    rm -f "${candidates}"
    scanner_error "無法建立暫存檔，full-tree audit 採 fail-closed。" "mktemp ignored"
    return 1
  }

  find "${template_dir}" \
    \( -path "${template_dir}/.git" \
      -o -path "${template_dir}/.agent" \
      -o -path "${template_dir}/.clade" \
      -o -path "${template_dir}/.claude" \
      -o -path "${template_dir}/.agents" \
      -o -path "${template_dir}/.codex" \
      -o -path "${template_dir}/.cursor" \
      -o -path "${template_dir}/.husky" \
      -o -path "${template_dir}/.vite-hooks" \
      -o -path "${template_dir}/.wrangler" \
      -o -path "${template_dir}/node_modules" \
      -o -path "${template_dir}/.nuxt" \
      -o -path "${template_dir}/.output" \
      -o -path "${template_dir}/docs/.vitepress/dist" \
      -o -path "${template_dir}/packages/create-nuxt-starter/dist" \
      -o -path "${template_dir}/packages/create-nuxt-starter/templates/*/node_modules" \
      -o -path "${template_dir}/dist" \
      -o -path "${template_dir}/coverage" \) -prune \
    -o -type f -print0 2>/dev/null > "${candidates}"

  # gitignored 的檔永遠進不了 git，也就永遠不可能洩漏進 starter seed——掃它們只會
  # 產生假陽性。實測 29 個 finding 有 28 個落在 template/temp/validate-starter/
  # （validate-starter 跑完留下的 scaffold 產物，.gitignore 已排除），把報告淹掉。
  #
  # 用 .gitignore 當判準，而不是繼續往上面的 prune 清單加路徑：prune 清單要人記得
  # 維護，而 .gitignore 本來就是「這些不進 repo」的單一真相層。
  # git check-ignore 無命中時 exit 1，那不是錯誤。
  (cd "${root}" && git check-ignore -z --stdin < "${candidates}" > "${ignored}") || true

  while IFS= read -r -d '' path; do
    if [[ -s "${ignored}" ]] && grep -qzxF -- "${path}" "${ignored}"; then
      continue
    fi
    scan_file "${root}" "${path}"
  done < "${candidates}"

  rm -f "${candidates}" "${ignored}"
}

print_report() {
  local printed=0
  local check_name index error

  if [[ ${#scanner_errors[@]} -gt 0 ]]; then
    for error in "${scanner_errors[@]}"; do
      printf '[Starter Hygiene] maintenance-script-misplacement 不通過\n'
      printf '問題: scanner error，starter hygiene audit 採 fail-closed。\n'
      printf '證據: %s\n' "${error}"
      printf '修正方式: 修正 scanner / rule / path 問題後重跑；若是檔案讀取問題，請手動檢查該檔案。\n'
      printf '繞過方式: 只有在 plan package / PR / commit context 記錄明確 rationale 後，才允許維護者明示 bypass。\n\n'
    done
    printed=1
  fi

  for check_name in "${REQUIRED_CHECKS[@]}"; do
    for index in "${!finding_checks[@]}"; do
      [[ "${finding_checks[${index}]}" == "${check_name}" ]] || continue
      printf '[Starter Hygiene] %s 不通過\n' "${check_name}"
      printf '問題: %s\n' "${finding_problems[${index}]}"
      printf '證據: %s\n' "${finding_evidence[${index}]}"
      printf '修正方式: %s\n' "${finding_fixes[${index}]}"
      printf '繞過方式: %s\n\n' "${finding_bypasses[${index}]}"
      printed=1
    done
  done

  if [[ ${printed} -eq 0 ]]; then
    printf '[Starter Hygiene] No starter hygiene findings detected in template/.\n'
  fi
}

main() {
  local root

  parse_args "$@" || true
  root="$(resolve_repo_root || true)"

  if [[ -n "${root:-}" ]]; then
    verify_check_names "${root}" || true
    scan_template_tree "${root}" || true
  fi

  print_report

  if [[ ${#scanner_errors[@]} -gt 0 || ${#finding_checks[@]} -gt 0 ]]; then
    return 1
  fi

  return 0
}

# 被 source 時只定義函式，不執行 main —— .husky/pre-commit 從這裡取用 check 函式，
# 兩份實作漂移過一次（12 個共用函式有 8 個不一致），不再各自維護副本。
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
