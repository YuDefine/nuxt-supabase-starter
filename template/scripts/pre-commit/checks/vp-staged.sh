#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# vp-staged — 對 staged 檔案跑 vite-plus lint + format
#
# - 排除 .claude/ 治理區（rules/skills/hooks/commands 都是 chmod 444 的副本）
# - lint --fix 自動修可修的問題
# - fmt 後 git add 把格式化結果重新 staged
# - bash 3.2 相容（macOS 預設）

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# clade 治理副本 — 永遠不該被 lint/fmt 處理（會被 chmod 444 擋住寫入，且行為應跟中央倉一致）
CLADE_MANAGED_PREFIXES=(
  '.claude/rules/'
  '.claude/skills/'
  '.claude/hooks/'
  '.claude/commands/'
  '.codex/'
  'codex/'
  '.agents/'
  'AGENTS.md'
)

is_clade_managed() {
  local file="$1"
  for prefix in "${CLADE_MANAGED_PREFIXES[@]}"; do
    case "$file" in
      "$prefix"*) return 0 ;;
    esac
  done
  return 1
}

lint_targets=()
fmt_targets=()

while IFS= read -r -d '' file; do
  [[ -f "$file" ]] || continue
  is_clade_managed "$file" && continue

  case "$file" in
    *.js|*.ts|*.tsx|*.mts|*.cts|*.vue|*.svelte)
      lint_targets+=("$file")
      fmt_targets+=("$file")
      ;;
    *.md|*.json|*.jsonc|*.yaml|*.yml|*.css|*.scss|*.html)
      fmt_targets+=("$file")
      ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACM -z)

if ((${#lint_targets[@]} > 0)); then
  echo "🔍 vp lint --fix (${#lint_targets[@]} files)..."
  pnpm exec vp lint --fix --no-error-on-unmatched-pattern "${lint_targets[@]}"
fi

if ((${#fmt_targets[@]} > 0)); then
  echo "🎨 vp fmt (${#fmt_targets[@]} files)..."
  pnpm exec vp fmt --no-error-on-unmatched-pattern "${fmt_targets[@]}"
  git add -- "${fmt_targets[@]}"
fi
