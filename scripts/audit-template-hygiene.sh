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
      "只有在 Spectra artifact / PR / commit context 記錄此檔為刻意保留且已去識別化後，才允許維護者明示 bypass。"
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
        "只有在 Spectra artifact / PR / commit context 記錄該值是去識別化範例後，才允許維護者明示 bypass。"
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
      "只有在 Spectra artifact / PR / commit context 記錄此值是無效範例且已去識別化後，才允許維護者明示 bypass。"
  fi
}

check_email_identifiers() {
  local path="$1"
  local blob="$2"
  local email domain

  while IFS= read -r email; do
    [[ -z "${email}" ]] && continue
    domain="$(printf '%s' "${email##*@}" | tr '[:upper:]' '[:lower:]')"

    case "${domain}" in
      example.com|example.org|example.net|example.test|*.example.com|localhost|localhost.local|test.local|invalid.test|test.com|email.com)
        continue
        ;;
    esac
    [[ "${email}" == git@github.com || "${email}" == noreply@anthropic.com || "${email}" == *"xxx@"* ]] && continue

    add_finding \
      "real-email-identifier" \
      "template content 含非 placeholder email，可能把可識別使用者資料帶進 starter。" \
      "${path} + email address pattern" \
      "改用 user@example.com、admin@example.test 或其他明確範例 domain。" \
      "只有在 Spectra artifact / PR / commit context 記錄該 email 為去識別化範例後，才允許維護者明示 bypass。"
    return 0
  done < <(grep -Eio -- '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' <<< "${blob}" || true)
}

check_tenant_identifiers() {
  local path="$1"
  local blob="$2"
  local uuid line lowered

  while IFS= read -r uuid; do
    [[ -z "${uuid}" ]] && continue
    if [[ "${uuid}" != "00000000-0000-0000-0000-000000000000" && "${uuid}" != "550e8400-e29b-41d4-a716-446655440000" ]]; then
      add_finding \
        "real-tenant-identifier" \
        "template content 含非 placeholder UUID，可能對應真實 tenant / org / user。" \
        "${path} + non-placeholder UUID pattern" \
        "改用 00000000-0000-0000-0000-000000000000、demo-tenant 或 example-org。" \
        "只有在 Spectra artifact / PR / commit context 記錄該 identifier 為去識別化範例後，才允許維護者明示 bypass。"
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
      "只有在 Spectra artifact / PR / commit context 記錄該 identifier 為去識別化範例後，才允許維護者明示 bypass。"
    return 0
  done < <(grep -Ei -- '(tenant|organization|org|customer|company)[_-]?(id|slug|key|name)?[[:space:]]*[:=][[:space:]]*["'\''][A-Za-z0-9][A-Za-z0-9._-]{5,}["'\'']' <<< "${blob}" || true)
}

check_starter_only_docs() {
  local path="$1"
  local blob="$2"

  [[ "${path}" == *.md ]] || return 0
  [[ "${path}" == template/.claude/* || "${path}" == template/.agents/* || "${path}" == template/.codex/* || "${path}" == template/openspec/* ]] && return 0
  [[ "${path}" == template/docs/decisions/* || "${path}" == template/docs/rules/* ]] && return 0
  [[ "${path}" == template/.examples/* || "${path}" == template/.starter/* || "${path}" == *.starter.md ]] && return 0

  if grep -Eiq -- '(starter-only|internal-only|do not scaffold|dogfood)' <<< "${blob}"; then
    add_finding \
      "unmarked-starter-only-doc" \
      "一般 starter 文件含 starter-only / internal-only 標記文字，但檔案路徑未明確標記。" \
      "${path} + starter-only marker category" \
      "改名為 *.starter.md，或移入 template/.starter/ / template/.examples/。" \
      "只有在 Spectra artifact / PR / commit context 記錄為刻意保留且路徑已補標記後，才允許維護者明示 bypass。"
  fi
}

check_dogfood_business_code() {
  local path="$1"
  local blob="$2"

  if grep -Fq -- "LOCKED" <<< "${blob}" && grep -Fq -- "managed by clade" <<< "${blob}"; then
    return 0
  fi

  if [[ "${path}" =~ ^template/(app/pages|app/components|server|supabase|tests|test)/ ]] && grep -Eiq -- '(dogfood|yuntech|sroi|tdms|perno|procurement|workstation|inspection_equipment|school[-_]window)' <<< "${blob}"; then
    add_finding \
      "dogfood-business-code" \
      "template content 含 dogfood / business-specific keyword，不能污染 scaffold seed。" \
      "${path} + business-specific keyword category" \
      "移到 root docs / examples / playground，或另開 change 設計為 starter-safe 範例。" \
      "只有在 Spectra artifact / PR / commit context 記錄該內容是去識別化 starter 範例後，才允許維護者明示 bypass。"
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
      "只有在 Spectra artifact / PR / commit context 記錄該 schema hint 是 starter-safe 範例後，才允許維護者明示 bypass。"
  fi
}

check_maintenance_script_misplacement() {
  local path="$1"
  local blob="$2"

  [[ "${path}" == template/scripts/* ]] || return 0

  if grep -Eiq -- '(starter hygiene|sync-to-agents|create-clean|scaffolder maintenance)' <<< "${blob}"; then
    add_finding \
      "maintenance-script-misplacement" \
      "root 維護腳本或 scaffolder tooling 不應放進會被 scaffold 帶走的 template/scripts/。" \
      "${path} + maintenance script category" \
      "移到 repo root scripts/；template/scripts/ 只保留 scaffold 後專案會用到的腳本。" \
      "只有在 Spectra artifact / PR / commit context 記錄該 script 是使用者專案 runtime 需要後，才允許維護者明示 bypass。"
  fi
}

is_text_file() {
  local file="$1"

  [[ ! -s "${file}" ]] && return 0
  LC_ALL=C grep -Iq . "${file}" 2>/dev/null
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
  local path

  if [[ ! -d "${template_dir}" ]]; then
    scanner_error "找不到 template/ 目錄，無法執行 full-tree hygiene audit。" "${template_dir}"
    return 1
  fi

  while IFS= read -r -d '' path; do
    scan_file "${root}" "${path}"
  done < <(
    find "${template_dir}" \
      \( -path "${template_dir}/.git" \
        -o -path "${template_dir}/.agent" \
        -o -path "${template_dir}/.clade" \
        -o -path "${template_dir}/.claude" \
        -o -path "${template_dir}/.agents" \
        -o -path "${template_dir}/.codex" \
        -o -path "${template_dir}/.cursor" \
        -o -path "${template_dir}/.husky" \
        -o -path "${template_dir}/.spectra" \
        -o -path "${template_dir}/.vite-hooks" \
        -o -path "${template_dir}/.wrangler" \
        -o -path "${template_dir}/openspec" \
        -o -path "${template_dir}/node_modules" \
        -o -path "${template_dir}/.nuxt" \
        -o -path "${template_dir}/.output" \
        -o -path "${template_dir}/docs/.vitepress/dist" \
        -o -path "${template_dir}/packages/create-nuxt-starter/dist" \
        -o -path "${template_dir}/packages/create-nuxt-starter/templates/*/node_modules" \
        -o -path "${template_dir}/dist" \
        -o -path "${template_dir}/coverage" \) -prune \
      -o -type f -print0 2>/dev/null
  )
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
      printf '繞過方式: 只有在 Spectra artifact / PR / commit context 記錄明確 rationale 後，才允許維護者明示 bypass。\n\n'
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

main "$@"
