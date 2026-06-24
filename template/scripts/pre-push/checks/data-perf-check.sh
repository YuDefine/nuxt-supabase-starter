#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# data-perf-check (pre-push, repo-wide) — 全站偵測 .vue 中 raw $fetch anti-pattern（HR-1）
#
# 跟 pre-commit 同名 check 的分工：
#   - pre-commit checks/data-perf-check.sh : 只掃本次 staged *.vue（blocking）
#   - pre-push  checks/data-perf-check.sh  : 掃全 repo *.vue（warn-only 回溯型；
#                                             既有 codebase 違規量大，暫不阻擋）
#
# 偵測 heuristic（file-level）：
#   .vue 檔含 `$fetch` 但不含 `useFetch` / `useQuery` / `useAsyncData`
#   → 代表所有 data-fetching 都走 raw $fetch，違反 HR-1。
#   含 composable 的 .vue 檔可以安全有 $fetch（event handler mutation），不被標記。
#
# Auto-detect：偵測 nuxt.config.* 存在才跑；非 Nuxt repo 自動 no-op（exit 0）。
#
# ⚠️ WARN-ONLY：本 check 目前只印 warning 不阻擋 push（exit 0），因為既有 codebase
#   通常有大量 raw $fetch 歷史債。等主要 consumer 清理完畢後再 promote 為 blocking。
#
# 合法例外 escape hatch：在檔案內任何位置加 `data-perf-ignore-file` 標記即跳過該檔。
#
# 正解：useFetch（SSR hydration）或 useQuery（Pinia Colada cache + dedup）。
# 規約來源：rules/core/nuxt-data-perf.md § HR-1
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# Auto-detect：無 nuxt.config 直接跳過
nuxt_config=""
for ext in ts mts js mjs; do
  if [[ -f "nuxt.config.$ext" ]]; then
    nuxt_config="nuxt.config.$ext"
    break
  fi
done
[[ -n "$nuxt_config" ]] || exit 0

# 全站收檔
vue_files=()
while IFS= read -r -d '' file; do
  vue_files+=("$file")
done < <(git ls-files -z -- '*.vue')

((${#vue_files[@]} == 0)) && exit 0

VIOLATIONS=()

for file in "${vue_files[@]}"; do
  # file-level escape hatch
  grep -q 'data-perf-ignore-file' "$file" 2>/dev/null && continue

  # 檢查：有 $fetch 但沒有 useFetch / useQuery / useAsyncData
  if grep -q '\$fetch' "$file" 2>/dev/null && \
     ! grep -qE 'useFetch|useQuery|useAsyncData' "$file" 2>/dev/null; then
    VIOLATIONS+=("$file")
  fi
done

if ((${#VIOLATIONS[@]} > 0)); then
  echo "⚠️  [warn] ${#VIOLATIONS[@]} 個 .vue 檔使用 raw \$fetch 但無 useFetch / useQuery / useAsyncData（HR-1）：" >&2
  for v in "${VIOLATIONS[@]}"; do
    echo "  $v" >&2
  done
  echo "" >&2
  echo "   正解：useFetch（SSR）或 useQuery（Colada cache）。純 mutation 檔加 data-perf-ignore-file。" >&2
  echo "   詳細：rules/core/nuxt-data-perf.md § HR-1" >&2
  echo "" >&2
  # warn-only：不阻擋 push
fi

exit 0
