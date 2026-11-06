#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-push/checks/data-perf-check.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-push/checks/data-perf-check.sh
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
#   .vue 檔含 `$fetch` 或 `apiFetch` 但不含 `useFetch` / `useLazyFetch` / `useAsyncData` /
#   `useLazyAsyncData` / `useQuery`
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
# 規約來源：rules/modules/framework/nuxt/nuxt-data-perf.md § HR-1
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

# PROJECT_ROOT 允許被 CLADE_PROJECT_ROOT 覆寫。meta-monorepo（app root 在子目錄，例如
# starter 型 repo 的 template/）的 app root ≠ git toplevel，而下方 auto-detect 是
# 「找不到 nuxt.config 就 exit 0」，直接用 toplevel 會讓這道 check 靜默 no-op。
# 未設 CLADE_PROJECT_ROOT 時行為與過去完全一致（既有 consumer 零影響）。
PROJECT_ROOT="${CLADE_PROJECT_ROOT:-$(git rev-parse --show-toplevel)}"
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

# raw fetch 偵測 token（grep -E）。預設含 `$fetch` 與 consumer 常見封裝 `apiFetch`
# （內部包 $fetch，不含字面 `$fetch`，原本整支漏偵測）。其他封裝名由 consumer 以環境變數
# CLADE_DATA_PERF_FETCH_PATTERN 覆寫，fleet 檔不硬編單一 consumer 專名。
DEFAULT_FETCH_PATTERN='\$fetch|\bapiFetch\b'
FETCH_PATTERN="${CLADE_DATA_PERF_FETCH_PATTERN:-$DEFAULT_FETCH_PATTERN}"

VIOLATIONS=()

for file in "${vue_files[@]}"; do
  # file-level escape hatch
  grep -q 'data-perf-ignore-file' "$file" 2>/dev/null && continue

  # 檢查：有 $fetch／apiFetch 但沒有任何 data-fetching composable
  #
  # regex 放寬的兩個理由（都來自實證誤判）：
  #   use(Lazy)?  — useLazyFetch / useLazyAsyncData 是 Nuxt 官方 composable
  #   use*Query   — Pinia Colada 的 domain wrapper 慣例是 use<Entity>Query
  #
  # 寧可放寬也不收窄：假陽性會逼出全檔豁免，掏空該檔的整體監控。
  if grep -qE "$FETCH_PATTERN" "$file" 2>/dev/null && \
     ! grep -qE 'use(Lazy)?(Fetch|AsyncData)|use[A-Za-z]*Query' "$file" 2>/dev/null; then
    VIOLATIONS+=("$file")
  fi
done

if ((${#VIOLATIONS[@]} > 0)); then
  echo "⚠️  [warn] ${#VIOLATIONS[@]} 個 .vue 檔使用 raw \$fetch / apiFetch 但無 useFetch / useLazyFetch / useAsyncData / useLazyAsyncData / useQuery（HR-1）：" >&2
  for v in "${VIOLATIONS[@]}"; do
    echo "  $v" >&2
  done
  echo "" >&2
  echo "   正解：useFetch（SSR）或 useQuery（Colada cache）。純 mutation 檔加 data-perf-ignore-file。" >&2
  echo "   詳細：rules/modules/framework/nuxt/nuxt-data-perf.md § HR-1" >&2
  echo "" >&2
  # warn-only：不阻擋 push
fi

exit 0
