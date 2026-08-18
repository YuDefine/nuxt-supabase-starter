#!/usr/bin/env bash
# =============================================================================
# audit-public-hygiene.test.sh — scripts/audit-public-hygiene.mjs 的 fixture 測試
#
# 每個 case 在 tmp 目錄裡搭一個最小 repo（只含 template/.claude 與 template/.cursor），
# 用 `--root` 指向它，斷言 exit code 與 JSON 報告內容。
#
# Usage: bash scripts/audit-public-hygiene.test.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_SCRIPT="${SCRIPT_DIR}/audit-public-hygiene.mjs"

tmp_root=""

cleanup() {
  if [[ -n "${tmp_root}" && -d "${tmp_root}" ]]; then
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

pass() {
  printf 'ok - %s\n' "$1"
}

# 搭一個 fixture repo，回傳其路徑（透過 $fixture）
make_fixture() {
  fixture="${tmp_root}/$1"
  mkdir -p "${fixture}/template/.claude/commands" "${fixture}/template/.cursor/commands"
  cat > "${fixture}/template/.claude/.hub-state.json" <<'JSON'
{
  "schemaVersion": 2,
  "rulesProjection": "copy",
  "checksums": {
    "commands/db-migration.md": "0000000000000000",
    "skills/spectra-apply/SKILL.md": "1111111111111111"
  }
}
JSON
}

# 取 JSON 報告某個欄位
json_field() {
  node -e '
    const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    const path = process.argv[2].split(".")
    let cur = data
    for (const key of path) cur = cur?.[key]
    console.log(Array.isArray(cur) ? cur.length : cur)
  ' "$1" "$2"
}

run_audit() {
  local root="$1"
  shift
  set +e
  node "${AUDIT_SCRIPT}" --root "${root}" "$@" > "${tmp_root}/out.txt" 2>&1
  audit_exit=$?
  set -e
}

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/audit-public-hygiene-test.XXXXXX")"

# ---------------------------------------------------------------------------
# Case 1: 只含 allowlist 內的 starter-owned command → PASS，0 violation
# ---------------------------------------------------------------------------
make_fixture clean
echo '# ship' > "${fixture}/template/.claude/commands/ship.md"
run_audit "${fixture}" --json
[[ ${audit_exit} -eq 0 ]] || fail "case1: expected exit 0, got ${audit_exit}"
[[ "$(json_field "${tmp_root}/out.txt" violations)" == "0" ]] || fail "case1: expected 0 violations"
[[ "$(json_field "${tmp_root}/out.txt" starter_owned_keep_count)" == "1" ]] \
  || fail "case1: expected starter_owned_keep_count 1"
pass "case1: allowlisted starter-owned command passes"

# ---------------------------------------------------------------------------
# Case 2: 未在 allowlist 的新 command → warning，default 仍 exit 0；--strict 則 exit 1
# ---------------------------------------------------------------------------
make_fixture unaudited
echo '# foo' > "${fixture}/template/.claude/commands/foo-unaudited.md"
run_audit "${fixture}" --json
[[ ${audit_exit} -eq 0 ]] || fail "case2: expected default exit 0, got ${audit_exit}"
[[ "$(json_field "${tmp_root}/out.txt" warnings)" == "1" ]] || fail "case2: expected 1 warning"
[[ "$(json_field "${tmp_root}/out.txt" violations)" == "0" ]] || fail "case2: expected 0 violations"
run_audit "${fixture}" --strict
[[ ${audit_exit} -eq 1 ]] || fail "case2: expected --strict exit 1, got ${audit_exit}"
grep -q 'public-hygiene-unaudited-command' "${tmp_root}/out.txt" \
  || fail "case2: expected unaudited check name in report"
pass "case2: unaudited command warns; --strict fails"

# ---------------------------------------------------------------------------
# Case 3: 已 relocate 的 validate-starter 殘留在 template/ → violation，exit 1
# ---------------------------------------------------------------------------
make_fixture relocated
echo '# validate-starter' > "${fixture}/template/.claude/commands/validate-starter.md"
run_audit "${fixture}"
[[ ${audit_exit} -eq 1 ]] || fail "case3: expected exit 1, got ${audit_exit}"
grep -q 'public-hygiene-relocated-artifact' "${tmp_root}/out.txt" \
  || fail "case3: expected relocated check name in report"
grep -q '繞過方式' "${tmp_root}/out.txt" || fail "case3: report missing 繞過方式 段"
run_audit "${fixture}" --report-only
[[ ${audit_exit} -eq 0 ]] || fail "case3: expected --report-only exit 0, got ${audit_exit}"
pass "case3: relocated artifact fails; --report-only still exits 0"

# ---------------------------------------------------------------------------
# Case 4: hub-state 列出的 clade-managed 檔案被跳過，不當成 unaudited
# ---------------------------------------------------------------------------
make_fixture clade_managed
echo '# db-migration' > "${fixture}/template/.claude/commands/db-migration.md"
echo '# spectra-apply' > "${fixture}/template/.cursor/commands/cursor-spectra-apply.md"
run_audit "${fixture}" --json
[[ ${audit_exit} -eq 0 ]] || fail "case4: expected exit 0, got ${audit_exit}"
[[ "$(json_field "${tmp_root}/out.txt" clade_managed_count)" == "2" ]] \
  || fail "case4: expected clade_managed_count 2 (含 .cursor 的 cursor- 前綴投影)"
[[ "$(json_field "${tmp_root}/out.txt" warnings)" == "0" ]] || fail "case4: expected 0 warnings"
pass "case4: clade-managed files skipped on both .claude and .cursor surfaces"

# ---------------------------------------------------------------------------
# Case 5: --json 輸出 schema 完整
# ---------------------------------------------------------------------------
make_fixture schema
echo '# ship' > "${fixture}/template/.claude/commands/ship.md"
run_audit "${fixture}" --json
node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  const required = [
    "clade_managed_count",
    "starter_owned_keep_count",
    "starter_owned_unaudited_count",
    "hub_state_found",
    "violations",
    "warnings",
  ]
  const missing = required.filter((key) => !(key in data))
  if (missing.length) {
    console.error("missing keys: " + missing.join(", "))
    process.exit(1)
  }
  if (!Array.isArray(data.violations) || !Array.isArray(data.warnings)) {
    console.error("violations / warnings must be arrays")
    process.exit(1)
  }
' "${tmp_root}/out.txt" || fail "case5: --json schema incomplete"
pass "case5: --json output carries the documented schema"

# ---------------------------------------------------------------------------
# Case 6: 缺 hub-state.json → 不 crash，hub_state_found 為 false
# ---------------------------------------------------------------------------
make_fixture no_hub_state
rm "${fixture}/template/.claude/.hub-state.json"
echo '# ship' > "${fixture}/template/.claude/commands/ship.md"
run_audit "${fixture}" --json
[[ ${audit_exit} -eq 0 ]] || fail "case6: expected exit 0, got ${audit_exit}"
[[ "$(json_field "${tmp_root}/out.txt" hub_state_found)" == "false" ]] \
  || fail "case6: expected hub_state_found false"
pass "case6: missing hub-state degrades gracefully"

printf '\nall %d cases passed\n' 6
exit 0
