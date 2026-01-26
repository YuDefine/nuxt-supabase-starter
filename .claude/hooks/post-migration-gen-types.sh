#!/bin/bash
# Hook: Migration 後自動產生 TypeScript types
# 觸發條件: mcp__local-supabase__apply_migration 完成後

set -e

cd "$CLAUDE_PROJECT_DIR"

echo "正在產生 TypeScript types..."
supabase gen types typescript --local > app/types/database.types.ts

echo "Types 已更新: app/types/database.types.ts"
