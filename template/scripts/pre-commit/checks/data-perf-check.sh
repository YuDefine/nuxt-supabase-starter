#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/data-perf-check.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/data-perf-check.sh
# CLADE:VENDOR-SCRIPT
#
# data-perf-check (pre-commit, staged) — 偵測 staged .vue 中 raw $fetch anti-pattern（HR-1）
#
# 跟 pre-push 同名 check 的分工：
#   - pre-commit checks/data-perf-check.sh : 只掃本次 staged *.vue（快擋，最接近犯錯時點）
#   - pre-push  checks/data-perf-check.sh  : 掃全 repo *.vue（warn-only 回溯型，不阻擋）
#
# 偵測 heuristic（file-level）：
#   staged .vue 檔含 `$fetch` 但不含 `useFetch` / `useLazyFetch` / `useAsyncData` /
#   `useLazyAsyncData` / `useQuery`
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
  #
  # herestring 而非 pipe：`grep -q` 命中即提前退出，pipe 上游的 echo 會收到 SIGPIPE(141)，
  # 在上面的 `set -o pipefail` 下讓整條 pipeline 回非零 → `&& continue` 不執行 →
  # 掛了豁免標記的檔仍被檢查。只在 .vue 超過 pipe buffer（~64KB）且標記在前段時觸發。
  # pre-push 版讀檔案路徑不經 pipe，本來就沒這個問題；這裡因為要讀 index 版而必須用變數。
  grep -q 'data-perf-ignore-file' <<< "$content" && continue

  # 檢查：有 $fetch 但沒有任何 data-fetching composable
  #
  # regex 放寬的兩個理由（都來自實證誤判）：
  #   use(Lazy)?  — useLazyFetch / useLazyAsyncData 是 Nuxt 官方 composable，
  #                 字面上不含 "useFetch" / "useAsyncData"
  #   use*Query   — Pinia Colada 的 domain wrapper 慣例是 use<Entity>Query
  #                 （如 useProcessMasterListQuery），字面上不含 "useQuery"
  #
  # 寧可放寬也不收窄：假陽性會逼開發者掛全檔 data-perf-ignore-file 豁免，
  # 該檔此後所有真違規都不再被偵測（gate 被自己掏空）；假陰性只是少抓一個，
  # review 層仍會看到。
  # herestring 同上——這兩條走 pipe 的話，大檔會讓 gate 靜默失效（$fetch 命中卻回非零 →
  # if 條件 false → 整個違規檢查被跳過，該擋沒擋）。
  if grep -q '\$fetch' <<< "$content" && \
     ! grep -qE 'use(Lazy)?(Fetch|AsyncData)|use[A-Za-z]*Query' <<< "$content"; then
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
