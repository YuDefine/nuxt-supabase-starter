#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# supabase-migration-safety — 對 staged supabase migrations 做安全檢查
#
# Auto-detect：偵測 supabase/migrations/ 目錄存在 + 有 staged
# supabase/migrations/*.sql 才跑。沒有 supabase 的 consumer 自動跳過。
#
# 規則：
#   1) 禁止 `SET search_path = public` 等具名 schema 設定
#      （Supabase function security best practice — 防 search_path injection）
#      所有 function 必須使用 SET search_path = ''（空字串）
#   2) supabase db lint --level warning（warn-only，不擋 commit）

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# Auto-detect：沒有 supabase/migrations/ 直接跳
[[ -d "supabase/migrations" ]] || exit 0

# 蒐集 staged 的 migration SQL
migration_files=()
while IFS= read -r -d '' file; do
  migration_files+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACM -z -- 'supabase/migrations/*.sql')

((${#migration_files[@]} == 0)) && exit 0

echo "🔍 偵測到 ${#migration_files[@]} 個 staged migration，執行安全檢查..."

# 1) search_path 檢查
forbidden=$(grep -nE "SET[[:space:]]+search_path[[:space:]]*=[[:space:]]*[^']" "${migration_files[@]}" 2>/dev/null || true)
if [[ -n "$forbidden" ]]; then
  cat <<EOF >&2

❌ 錯誤：發現禁止的 search_path 設定！

$forbidden

⚠️  所有函數必須使用 SET search_path = ''（空字串）
   理由：Supabase function security best practice，防止 search_path injection
   參考：https://supabase.com/docs/guides/database/functions#security-considerations

正確範例：
  SET search_path = ''               -- ✅ 正確

錯誤範例：
  SET search_path = public, pg_temp  -- ❌ 錯誤
  SET search_path = public           -- ❌ 錯誤

EOF
  exit 1
fi

# 2) supabase db lint（warn-only）
if command -v supabase >/dev/null 2>&1; then
  echo "🔍 supabase db lint --level warning..."
  if ! supabase db lint --level warning 2>/dev/null; then
    cat <<'EOF' >&2

⚠️  supabase linter 發現問題（不擋 commit，但建議修正）
    詳情：supabase db lint --level warning

EOF
  else
    echo "✅ supabase linter 通過"
  fi
else
  echo "⊘ 未安裝 supabase CLI — 跳過 db lint" >&2
fi

echo "✅ migration 安全檢查完成"
