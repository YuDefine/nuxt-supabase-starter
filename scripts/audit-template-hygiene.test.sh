#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_SCRIPT="${SCRIPT_DIR}/audit-template-hygiene.sh"

tmp_root=""

cleanup() {
  if [[ -n "${tmp_root}" && -d "${tmp_root}" ]]; then
    rm -rf "${tmp_root}"
  fi
}
trap cleanup EXIT

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'ok - %s\n' "$1"
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
  grep -Fvq "abcdefghijklmnopqrstuvwxyz1234567890" <<< "${output}" || fail "secret report redacts full token"
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

[[ -x "${AUDIT_SCRIPT}" || -f "${AUDIT_SCRIPT}" ]] || fail "audit script exists"

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/starter-hygiene-test.XXXXXX")"

assert_clean_fixture
assert_private_env_fixture
assert_secret_fixture
assert_identifier_fixture
assert_starter_only_doc_fixture
assert_template_cwd_root_detection

printf 'All audit-template-hygiene fixture cases passed.\n'
