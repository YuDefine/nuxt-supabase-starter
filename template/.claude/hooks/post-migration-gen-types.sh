#!/bin/bash
# Hook: Migration 後自動產生 TypeScript types
# 觸發條件: mcp__local-supabase__apply_migration 完成後
# 支援 local 和 remote 模式（透過 pnpm db:types 自動切換）

set -e

# Monorepo detection
if [ -d "${CLAUDE_PROJECT_DIR}/template/app" ]; then
  _PROJECT="${CLAUDE_PROJECT_DIR}/template"
else
  _PROJECT="${CLAUDE_PROJECT_DIR}"
fi

cd "$_PROJECT"

echo "正在產生 TypeScript types..."
pnpm db:types

echo "Types 已更新: app/types/database.types.ts"
