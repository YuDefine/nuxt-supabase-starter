#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$ROOT_DIR/template/packages/create-nuxt-starter"
CLI_DIST="$CLI_DIR/dist/cli.js"
CLI_SRC="$CLI_DIR/src/cli.ts"

TARGET_PATH=""
AUTH_MODE="nuxt-auth-utils"
EXTRA_ARGS=()

# Parse arguments: first positional = target path, rest are passed through to CLI
while [[ $# -gt 0 ]]; do
  case "$1" in
    --auth)
      AUTH_MODE="${2:-nuxt-auth-utils}"
      shift 2
      ;;
    --with|--without|--minimal|--preset)
      EXTRA_ARGS+=("$1")
      if [[ "$1" != "--minimal" ]]; then
        EXTRA_ARGS+=("${2:-}")
        shift
      fi
      shift
      ;;
    --fast)
      # already included by default, accept silently
      shift
      ;;
    -*)
      EXTRA_ARGS+=("$1")
      shift
      ;;
    *)
      if [[ -z "$TARGET_PATH" ]]; then
        TARGET_PATH="$1"
      else
        EXTRA_ARGS+=("$1")
      fi
      shift
      ;;
  esac
done

if [[ -z "$TARGET_PATH" ]]; then
  echo "Usage: bash scripts/create-fast-project.sh <target-path> [options]"
  echo ""
  echo "Options:"
  echo "  --auth <mode>           nuxt-auth-utils (default) | better-auth | none"
  echo "  --with <features>       Add features (comma-separated)"
  echo "  --without <features>    Remove features (comma-separated)"
  echo "  --minimal               Start with empty feature set"
  echo ""
  echo "Examples:"
  echo "  bash scripts/create-fast-project.sh temp/my-app"
  echo "  bash scripts/create-fast-project.sh temp/my-app --auth better-auth"
  echo "  bash scripts/create-fast-project.sh temp/my-app --auth better-auth --with ssr,seo,monitoring"
  echo "  bash scripts/create-fast-project.sh temp/my-app --without charts,security --with monitoring"
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
else
  TARGET_DIR="$ROOT_DIR/$TARGET_PATH"
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
  "$TARGET_DIR" \
  --yes \
  --fast \
  --auth "$AUTH_MODE" \
  "${EXTRA_ARGS[@]}"

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
