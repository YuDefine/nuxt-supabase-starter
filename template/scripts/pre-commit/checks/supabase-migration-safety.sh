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
#   2) Out-of-order timestamp 檢查
#      新增 / rename 的 migration timestamp 必須晚於 origin/main 上的 latest
#      （supabase db push 預設拒絕 out-of-order，會讓 production deploy 紅燈）
#   3) supabase db lint --level warning（warn-only，不擋 commit）

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
# 用 awk 做 per-statement 驗證：先剝掉 `--` 行尾註解，再依 `;` 切成多個 statement，
# 對每個 `SET search_path = X` 個別判斷。唯一允許 X = `''`（空字串）。
# 為什麼不用 line-level grep -v：`SET search_path = ''; SET search_path = public`
# 同一行混合允許 + 禁止形式時，line-level 過濾會把整行視為允許而漏掉違規 statement。
forbidden=$(awk '
  function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
  {
    line = $0
    sub(/[ \t]*--.*$/, "", line)              # strip line comment
    n = split(line, stmts, ";")
    for (i = 1; i <= n; i++) {
      s = trim(stmts[i])
      if (s == "") continue
      if (match(s, /^SET[ \t]+search_path[ \t]*=[ \t]*/)) {
        val = trim(substr(s, RSTART + RLENGTH))
        if (val != "\047\047") {              # \047 = single quote
          printf("%s:%d: %s\n", FILENAME, NR, s)
        }
      }
    }
  }
' "${migration_files[@]}" 2>/dev/null || true)
if [[ -n "$forbidden" ]]; then
  cat <<EOF >&2

❌ 錯誤：發現禁止的 search_path 設定！

$forbidden

⚠️  所有函數必須使用 SET search_path = ''（空字串）
   理由：Supabase function security best practice，防止 search_path injection
   參考：https://supabase.com/docs/guides/database/functions#security-considerations

正確範例：
  SET search_path = ''               -- ✅ 正確
  SET search_path = '';              -- ✅ 正確

錯誤範例：
  SET search_path = public, pg_temp  -- ❌ 錯誤
  SET search_path = public           -- ❌ 錯誤
  SET search_path = 'public'         -- ❌ 錯誤（帶引號的非空字串）
  SET search_path = '', public       -- ❌ 錯誤（空字串後仍接非空 schema）

EOF
  exit 1
fi

# 2) Out-of-order timestamp 檢查
# 抓 staged 新增 (A) + rename (R) 的 migration（rename 後新名也要符合順序）
out_of_order=()
while IFS= read -r -d '' file; do
  out_of_order+=("$file")
done < <(git diff --cached --name-only --diff-filter=AR -z -- 'supabase/migrations/*.sql')

if ((${#out_of_order[@]} > 0)); then
  # origin/main 上 supabase/migrations/*.sql 的 latest timestamp
  # 不主動 fetch（避免拖慢 commit），用 local cached origin/main ref
  latest_on_main=""
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    latest_on_main=$(
      git ls-tree -r --name-only origin/main -- 'supabase/migrations/' 2>/dev/null \
        | awk -F/ '{print $NF}' \
        | grep -oE '^[0-9]{14}' \
        | sort -n \
        | tail -1
    )
  fi

  if [[ -n "$latest_on_main" ]]; then
    fail_entries=()
    for f in "${out_of_order[@]}"; do
      bname=$(basename "$f")
      [[ "$bname" =~ ^[0-9]{14}_ ]] || continue
      ts="${bname:0:14}"
      if [[ "$ts" < "$latest_on_main" || "$ts" == "$latest_on_main" ]]; then
        fail_entries+=("$f|$ts")
      fi
    done

    if ((${#fail_entries[@]} > 0)); then
      now=$(date -u +%Y%m%d%H%M%S)
      cat <<EOF >&2

❌ 錯誤：偵測到 out-of-order migration（timestamp 早於或等於 origin/main latest）！

origin/main 上 latest migration timestamp: $latest_on_main

問題檔案：
EOF
      for entry in "${fail_entries[@]}"; do
        f="${entry%|*}"
        ts="${entry##*|}"
        echo "  $f (timestamp: $ts)" >&2
      done
      cat <<EOF >&2

⚠️  Supabase db push 預設拒絕 out-of-order migration —
   tag push 觸發 production deploy 時會紅燈。

修正方式（rename 到當下 UTC timestamp）：
EOF
      for entry in "${fail_entries[@]}"; do
        f="${entry%|*}"
        bname=$(basename "$f")
        # 切掉 14 位 timestamp + 底線，保留 descriptor
        rest="${bname:15}"
        echo "  git mv $f supabase/migrations/${now}_${rest}" >&2
      done
      cat <<'EOF' >&2

繞過：若已驗證遠端環境從未 applied 此 migration、確需保留原 timestamp，
      此 hook 仍會擋；請依上述 git mv 命令重新命名後再 commit。

詳細規則：rules/modules/db-runtime/supabase-self-hosted/migration.md
          「Timestamp 順序契約」段落

EOF
      exit 1
    fi
  fi
fi

# 3) supabase db lint（warn-only）
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
