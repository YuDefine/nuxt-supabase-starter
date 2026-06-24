#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# data-perf-check (pre-commit, staged) — 偵測 staged .vue 中 raw $fetch anti-pattern（HR-1）
#
# 跟 pre-push 同名 check 的分工：
#   - pre-commit checks/data-perf-check.sh : 只掃本次 staged *.vue（快擋，最接近犯錯時點）
#   - pre-push  checks/data-perf-check.sh  : 掃全 repo *.vue（warn-only 回溯型，不阻擋）
#
# 偵測 heuristic（file-level）：
#   staged .vue 檔含 `$fetch` 但不含 `useFetch` / `useQuery` / `useAsyncData`
#   → 代表所有 data-fetching 都走 raw $fetch，違反 HR-1（setup context 應用 composable）。
#   含 composable 的 .vue 檔可以安全有 $fetch（event handler mutation），不被標記。
#
# Auto-detect：只掃本次 commit staged 的 *.vue；無 staged .vue 直接跳過。
# 非 Nuxt / 無 .vue 的 consumer 與不碰 data-fetching 的 commit 自動 no-op（exit 0）。
#
# 合法例外 escape hatch：在檔案內任何位置加 `data-perf-ignore-file` 標記即跳過該檔。
#   範例：<!-- data-perf-ignore-file: pure mutation component, no data fetching -->
#
# 正解：useFetch（SSR hydration）或 useQuery（Pinia Colada cache + dedup）。
# 規約來源：
#   - impl-time rule : rules/core/nuxt-data-perf.md § HR-1
#   - review-layer   : plugins/hub-core/agents/references/clade-review-rules.md
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

staged_vue=()
while IFS= read -r -d '' file; do
  staged_vue+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACM -z -- '*.vue')

# 無 staged .vue → 跳過
((${#staged_vue[@]} == 0)) && exit 0

VIOLATIONS=()

for file in "${staged_vue[@]}"; do
  # staged content（讀 index 版，不是 working tree）
  content=$(git show :"$file" 2>/dev/null) || continue

  # file-level escape hatch
  echo "$content" | grep -q 'data-perf-ignore-file' && continue

  # 檢查：有 $fetch 但沒有 useFetch / useQuery / useAsyncData
  if echo "$content" | grep -q '\$fetch' && \
     ! echo "$content" | grep -qE 'useFetch|useQuery|useAsyncData'; then
    VIOLATIONS+=("$file")
  fi
done

if ((${#VIOLATIONS[@]} > 0)); then
  echo "❌ .vue 檔使用 raw \$fetch 但無 useFetch / useQuery / useAsyncData（HR-1）：" >&2
  for v in "${VIOLATIONS[@]}"; do
    echo "  $v" >&2
  done
  echo "" >&2
  cat <<'EOF' >&2
⚠️  .vue 檔內只有 $fetch 而無 data-fetching composable，代表 setup-level
   資料取得可能走了 raw $fetch → double fetch + hydration mismatch + 無 cache。

正解：
  SSR hydration         → useFetch('/api/items')
  Pinia Colada cache    → useQuery({ key: [...], query: () => $fetch('/api/items') })
  Event handler mutation → $fetch 不受此限

   若此檔確實只有 mutation 而無 data-fetching 需求，加標記跳過：
   <!-- data-perf-ignore-file: pure mutation component -->

詳細規約：rules/core/nuxt-data-perf.md § HR-1
EOF
  exit 1
fi

exit 0
