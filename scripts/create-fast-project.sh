#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$ROOT_DIR/template/packages/create-nuxt-starter"
CLI_DIST="$CLI_DIR/dist/cli.mjs"
CLI_SRC="$CLI_DIR/src/cli.ts"

TARGET_PATH=""
AUTH_MODE="nuxt-auth-utils"
EXTRA_ARGS=()
PLAYGROUND=0

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
    --playground)
      # 具名豁免：只給 starter 自測／playground 重建（不是真專案），否則一律走 --techstack-record
      PLAYGROUND=1
      shift
      ;;
    --techstack-record)
      EXTRA_ARGS+=("$1" "${2:-}")
      shift 2
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
  echo "  --techstack-record <p>  Charles 逐項確認過的 docs/techstack-confirmation.md（真專案必填）"
  echo "  --playground            自測／playground 專用：豁免 tech stack 確認（NEVER 用於真專案）"
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

# tech stack 確認閘門：預設走 --techstack-record（缺了由 CLI 以 TECHSTACK_RECORD_MISSING 拒絕）；
# 只有明確帶 --playground 才豁免，絕不預設豁免。
GATE_ARGS=()
if [[ "$PLAYGROUND" -eq 1 ]]; then
  GATE_ARGS=(--techstack-playground-exempt)
fi

if [[ -e "$TARGET_DIR" ]]; then
  echo "[ERROR] target already exists: $TARGET_DIR"
  exit 1
fi

echo "[1/3] install scaffold dependencies"
pnpm --dir "$ROOT_DIR/template" install --filter create-nuxt-starter --ignore-scripts

if [[ ! -f "$CLI_DIST" ]] || \
   find "$CLI_DIR/src" -type f -newer "$CLI_DIST" | grep -q . || \
   [[ "$CLI_DIR/package.json" -nt "$CLI_DIST" ]] || \
   [[ -f "$CLI_DIR/tsconfig.json" && "$CLI_DIR/tsconfig.json" -nt "$CLI_DIST" ]]; then
  echo "[1.5/3] build scaffold cli"
  pnpm --dir "$CLI_DIR" run build
fi

echo "[2/3] scaffold project (fast profile)"
# wrapper 提供 "fast profile" 語義：跳過 testing，其餘走 cloudflare-supabase preset 預設。
# CLI 的 --fast flag 已移除，改用 --without testing-full,testing-vitest 達到等價效果。
if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  node "$CLI_DIST" \
    "$TARGET_DIR" \
    --yes \
    --db-host this-machine \
    --no-register-consumer \
    ${GATE_ARGS[@]+"${GATE_ARGS[@]}"} \
    --without testing-full,testing-vitest \
    --auth "$AUTH_MODE" \
    "${EXTRA_ARGS[@]}"
else
  node "$CLI_DIST" \
    "$TARGET_DIR" \
    --yes \
    --db-host this-machine \
    --no-register-consumer \
    ${GATE_ARGS[@]+"${GATE_ARGS[@]}"} \
    --without testing-full,testing-vitest \
    --auth "$AUTH_MODE"
fi

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
