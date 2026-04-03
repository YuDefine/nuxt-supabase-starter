#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$ROOT_DIR/template/packages/create-nuxt-starter"
CLI_DIST="$CLI_DIR/dist/cli.js"
CLI_SRC="$CLI_DIR/src/cli.ts"

TARGET_PATH="${1:-}"
AUTH_MODE="${2:-nuxt-auth-utils}"

if [[ -z "$TARGET_PATH" ]]; then
  echo "Usage: bash scripts/create-fast-project.sh <target-path> [auth]"
  echo ""
  echo "Examples:"
  echo "  bash scripts/create-fast-project.sh temp/my-app"
  echo "  bash scripts/create-fast-project.sh temp/my-app better-auth"
  echo ""
  echo "auth: nuxt-auth-utils | better-auth | none"
  exit 1
fi

case "$AUTH_MODE" in
  nuxt-auth-utils|better-auth|none)
    ;;
  *)
    echo "[ERROR] invalid auth mode: $AUTH_MODE"
    echo "allowed: nuxt-auth-utils | better-auth | none"
    exit 1
    ;;
esac

if [[ "$TARGET_PATH" = /* ]]; then
  TARGET_DIR="$TARGET_PATH"
  TARGET_ARG="$TARGET_PATH"
else
  TARGET_DIR="$ROOT_DIR/$TARGET_PATH"
  TARGET_ARG="$TARGET_PATH"
fi

if [[ -e "$TARGET_DIR" ]]; then
  echo "[ERROR] target already exists: $TARGET_DIR"
  exit 1
fi

echo "[1/3] install scaffold dependencies"
pnpm --dir "$ROOT_DIR" install --filter create-nuxt-starter --ignore-scripts

if [[ ! -f "$CLI_DIST" || "$CLI_SRC" -nt "$CLI_DIST" ]]; then
  echo "[1.5/3] build scaffold cli"
  pnpm --dir "$CLI_DIR" run build
fi

echo "[2/3] scaffold project (fast profile)"
node "$CLI_DIST" \
  "$TARGET_ARG" \
  --yes \
  --fast \
  --auth "$AUTH_MODE"

echo "[3/3] keyword scan (should be empty)"
if command -v rg >/dev/null 2>&1; then
  rg -ni "nuxt[- ]supabase starter|nuxt-supabase-starter|demo" "$TARGET_DIR" \
    --glob '!node_modules/**' \
    --glob '!.git/**' \
    --glob '!.nuxt/**' \
    --glob '!coverage/**' \
    --glob '!pnpm-lock.yaml' \
    --glob '!README.md' \
    || true
else
  grep -RInE "nuxt[- ]supabase starter|nuxt-supabase-starter|demo" "$TARGET_DIR" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=.nuxt \
    --exclude-dir=coverage \
    --exclude=pnpm-lock.yaml \
    --exclude=README.md \
    || true
fi

echo ""
echo "Done: $TARGET_DIR"
