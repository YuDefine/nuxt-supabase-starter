#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/vp-staged.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/vp-staged.sh
# CLADE:VENDOR-SCRIPT
#
# vp-staged — 對 staged 檔案跑 vite-plus lint + format
#
# - 排除 clade 投影層：判定來自 vendor/oxc-shared/preset.ts 的 isStagedExcluded（經 staged-targets.ts）
# - lint --fix 自動修可修的問題
# - fmt 後 git add 把格式化結果重新 staged
# - bash 3.2 相容（macOS 預設）

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# Auto-detect vite-plus 是否裝在此 consumer
# 沒裝就 skip（graceful — 適用 non-vite-plus consumer 如純 nuxt + eslint 專案）
if ! pnpm exec vp --version >/dev/null 2>&1; then
  echo "⊘ vp 未安裝 — skip vp-staged check（如為 vite-plus 專案請 pnpm add -D vite-plus）"
  exit 0
fi

# 哪些 staged 檔不該被 lint/fmt（clade 投影層 ＋ 只有 pre-commit 需要的排除）的判定**不在本檔**：
# 一律經 ../staged-targets.ts 讀 vendor/oxc-shared/preset.ts 的 `isStagedExcluded`。
# NEVER 在這裡手寫路徑清單——TD-777 之前本檔的 `CLADE_MANAGED_PREFIXES` 就是那份平行清單，
# 與 preset 的 PROJECTION_EXCLUDES 雙向漂移（缺 .spectra/ .cursor/、.claude/ 只列 5 個子目錄）。
#
# 橋接失敗 MUST 非零退出：拿不到清單時「全部放行」會把投影檔送進 lint/fmt，
# 「全部排除」會讓整個 check 靜默變成 no-op，兩者在輸出上都像正常。
if ! command -v node >/dev/null 2>&1; then
  echo "[clade pre-commit] vp-staged：PATH 內找不到 node，無法讀 preset 的過濾判定（TD-777）" >&2
  exit 2
fi

STAGED_TARGETS_TS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/staged-targets.ts"
if [[ ! -f "$STAGED_TARGETS_TS" ]]; then
  echo "[clade pre-commit] vp-staged：找不到 $STAGED_TARGETS_TS（投影不完整，跑 pnpm hub:vendor）" >&2
  exit 2
fi

# bash 3.2 沒有 mapfile，而 command substitution 會吃掉 NUL —— 走暫存檔。
# trap 引用的是全域變數（不宣告 local），清理時一定拿得到值。
VP_STAGED_ALL="$(mktemp)"
VP_STAGED_KEPT="$(mktemp)"
trap 'rm -f "$VP_STAGED_ALL" "$VP_STAGED_KEPT"' EXIT

git diff --cached --name-only --diff-filter=ACM -z >"$VP_STAGED_ALL"
if ! node "$STAGED_TARGETS_TS" <"$VP_STAGED_ALL" >"$VP_STAGED_KEPT"; then
  echo "[clade pre-commit] vp-staged：staged-targets 橋接失敗，拒絕在沒有過濾清單的情況下跑 lint/fmt" >&2
  exit 2
fi

lint_targets=()
fmt_targets=()

while IFS= read -r -d '' file; do
  [[ -f "$file" ]] || continue

  case "$file" in
    *.js|*.ts|*.tsx|*.ts|*.cts|*.vue|*.svelte)
      lint_targets+=("$file")
      fmt_targets+=("$file")
      ;;
    *.md|*.json|*.jsonc|*.yaml|*.yml|*.css|*.scss|*.html)
      fmt_targets+=("$file")
      ;;
  esac
done <"$VP_STAGED_KEPT"

# vp 在 staged paths 全被 vite.config.lint.ignorePatterns / .oxfmtrc.json ignore 後會 exit 非零 +
# 印 (a) 舊版「No files found to (lint|format)」(b) 新版「Expected at least one target file」
# 兩種訊息都視為 success（不是真正的 lint/fmt error）
run_vp_with_empty_tolerance() {
  local out exit_code=0
  out="$(pnpm exec "$@" 2>&1)" || exit_code=$?
  echo "$out"
  if ((exit_code != 0)); then
    if echo "$out" | grep -qE "No files found to (lint|format)|Expected at least one target file"; then
      return 0
    fi
    return "$exit_code"
  fi
}

if ((${#lint_targets[@]} > 0)); then
  echo "🔍 vp lint --fix (${#lint_targets[@]} files)..."
  run_vp_with_empty_tolerance vp lint --fix "${lint_targets[@]}"
fi

if ((${#fmt_targets[@]} > 0)); then
  echo "🎨 vp fmt (${#fmt_targets[@]} files)..."
  run_vp_with_empty_tolerance vp fmt "${fmt_targets[@]}"
  # -f：fmt_targets 全部來自「已 staged」清單，這一步只是把 formatter 剛改過的內容收回 staged
  # 區，不會憑空 stage 使用者沒選的路徑。不帶 -f 時，只要清單裡有「已 tracked 但同時被
  # .gitignore 命中」的檔（ignore 規則在檔案進版控之後才加就會這樣，git status 看不出來），
  # git add 就整個 fail、pre-commit exit 1，該 consumer 的 commit 永久做不成（TD-313）。
  git add -f -- "${fmt_targets[@]}"
fi
