#!/usr/bin/env bash
# =============================================================================
# smoke-scaffold.sh — 新專案導向 smoke 驗收
#
# Usage:
#   bash scripts/smoke-scaffold.sh
#   bash scripts/smoke-scaffold.sh temp/my-smoke-project
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$ROOT_DIR/template/packages/create-nuxt-starter"
CLI_DIST="$CLI_DIR/dist/cli.js"
CLI_SRC="$CLI_DIR/src/cli.ts"

TARGET_INPUT="${1:-}"
if [[ -n "$TARGET_INPUT" ]]; then
  if [[ "$TARGET_INPUT" = /* ]]; then
    TARGET_DIR="$TARGET_INPUT"
  else
    TARGET_DIR="$ROOT_DIR/$TARGET_INPUT"
  fi
else
  TARGET_DIR="$ROOT_DIR/temp/scaffold-smoke-$(date +%Y%m%d-%H%M%S)"
fi

PROJECT_NAME="$(basename "$TARGET_DIR")"

info() {
  echo "[INFO] $1"
}

pass() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

run_step() {
  local label="$1"
  info "$label"
  shift
  "$@"
  pass "$label"
}

scan_placeholders() {
  local target="$1"
  # demo MUST 帶詞界：沒有詞界時 demonstrate / demonstrably 也會中，實測誤判
  # scripts/claim-helper.ts:500 與 vendor/oxc-shared/preset.ts:107 兩處。誤判混在真訊號
  # 裡會讓人以為這條 gate 在亂報，進而整條略過——真訊號（clade 投影未去識別化，TD-019）
  # 就跟著被略過。
  local pattern='nuxt[- ]supabase starter|nuxt-supabase-starter|\bdemo\b|\{\{projectName\}\}|TODO: 替換|my-project'

  if command -v rg >/dev/null 2>&1; then
    rg -n "$pattern" "$target" \
      --glob '!node_modules/**' \
      --glob '!.git/**' \
      --glob '!.nuxt/**' \
      --glob '!coverage/**' \
      --glob '!.claude/**' \
      --glob '!pnpm-lock.yaml' \
      --glob '!README.md' \
      --glob '!.scaffold-cleanup' \
      --glob '!verify-starter.mjs' \
      --glob '!scripts/audit-clade-leak.mjs' \
      || true
  else
    grep -RInE "$pattern" "$target" \
      --exclude-dir=node_modules \
      --exclude-dir=.git \
      --exclude-dir=.nuxt \
      --exclude-dir=coverage \
      --exclude-dir=.claude \
      --exclude=pnpm-lock.yaml \
      --exclude=README.md \
      --exclude=.scaffold-cleanup \
      --exclude=verify-starter.mjs \
      --exclude=audit-clade-leak.mjs \
      || true
  fi
}

if [[ -e "$TARGET_DIR" ]]; then
  fail "target already exists: $TARGET_DIR"
fi

cd "$ROOT_DIR"

run_step \
  "install scaffold deps" \
  pnpm --dir "$ROOT_DIR/template" install --filter create-nuxt-starter --ignore-scripts

if [[ ! -f "$CLI_DIST" ]] || \
   find "$CLI_DIR/src" -type f -newer "$CLI_DIST" | grep -q . || \
   [[ "$CLI_DIR/package.json" -nt "$CLI_DIST" ]] || \
   [[ -f "$CLI_DIR/tsconfig.json" && "$CLI_DIR/tsconfig.json" -nt "$CLI_DIST" ]]; then
  run_step \
    "build scaffold cli" \
    pnpm --dir "$CLI_DIR" run build
fi

run_step \
  "scaffold project (non-interactive defaults)" \
  node "$CLI_DIST" "$TARGET_DIR" --yes --db-host this-machine --no-register-consumer

if [[ ! -f "$TARGET_DIR/package.json" ]]; then
  fail "missing package.json in scaffolded project"
fi

# NEVER 把 .claude/commands/validate-starter.md 加回這份清單：17f080cf 依 L3 commands
# hygiene 把它判成 starter-owned-relocate，維護者版本在 root .claude/commands/，
# 刻意不進 template/ 也就不會出現在 scaffold 輸出。它留在這裡的期間（2026-09-05 起）
# 這支 gate 每一趟都紅。反向約束由 audit-public-hygiene.mjs 的
# public-hygiene-relocated-artifact 顧，不需要在這裡再擋一次。
for required_path in \
  "$TARGET_DIR/.claude/settings.json" \
  "$TARGET_DIR/.claude/versions.json" \
  "$TARGET_DIR/scripts/compress-skill-descriptions.sh" \
  "$TARGET_DIR/scripts/templates/clean/README.md"; do
  if [[ ! -e "$required_path" ]]; then
    fail "missing shared template asset: $required_path"
  fi
done
pass "shared template assets copied"

if [[ -e "$TARGET_DIR/.scaffold-cleanup" ]]; then
  fail "scaffold output unexpectedly contains .scaffold-cleanup"
fi
pass "no deferred cleanup marker generated"

if grep -q 'rm -rf "$CLEANUP_PATH"' "$TARGET_DIR/scripts/setup.sh"; then
  fail "setup.sh still contains dangerous auto-delete cleanup"
fi
pass "setup.sh keeps cleanup manual"

if grep -qE 'for skill in .*arrange.*extract.*frontend-design.*harden.*normalize.*onboard.*teach-impeccable' "$TARGET_DIR/scripts/install-skills.sh"; then
  fail "install-skills.sh still contains removed upstream impeccable skill ids"
fi
pass "install-skills.sh uses supported upstream skill ids"

PACKAGE_NAME="$(node -e "const p=require('$TARGET_DIR/package.json'); process.stdout.write(p.name)")"
if [[ "$PACKAGE_NAME" != "$PROJECT_NAME" ]]; then
  fail "package.json name mismatch: expected '$PROJECT_NAME', got '$PACKAGE_NAME'"
fi
pass "package.json name replaced: $PACKAGE_NAME"

if [[ -f "$TARGET_DIR/wrangler.jsonc" ]]; then
  if grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"$PROJECT_NAME\"" "$TARGET_DIR/wrangler.jsonc"; then
    pass "wrangler.jsonc name replaced: $PROJECT_NAME"
  else
    fail "wrangler.jsonc name was not replaced to '$PROJECT_NAME'"
  fi
fi

PLACEHOLDER_HITS="$(scan_placeholders "$TARGET_DIR")"

if [[ -n "$PLACEHOLDER_HITS" ]]; then
  echo "$PLACEHOLDER_HITS"
  fail "placeholder scan found unexpected hits"
fi
pass "placeholder scan clean"

run_step "typecheck" pnpm --dir "$TARGET_DIR" run typecheck
run_step "unit tests" pnpm --dir "$TARGET_DIR" run test:unit
run_step "full tests" pnpm --dir "$TARGET_DIR" run test

if node -e "const p=require('$TARGET_DIR/package.json'); process.exit(p.scripts && p.scripts.check ? 0 : 1)"; then
  run_step "quality check" pnpm --dir "$TARGET_DIR" run check
else
  fail "missing 'check' script in scaffolded project (expected in default preset)"
fi

echo ""
echo "Smoke validation passed"
echo "Project: $TARGET_DIR"
