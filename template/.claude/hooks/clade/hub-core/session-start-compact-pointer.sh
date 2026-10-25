#!/usr/bin/env bash
# SessionStart(matcher: compact) hook — 壓縮完成後注入一行 pointer，指回 PreCompact 落盤檔。
# **永遠 exit 0；只印一行，長度由 test/pre-compact-snapshot.test.ts 釘住。**
#
# 實測 threshold 壓縮後 SessionStart 以 `source:"compact"` fire（plan
# W-2026-10-20-autocompact-300k-600k-plan-package-hook-helper-d evidence/2026-10-21-探測P1-P5.md § P4）。
# 落盤內容住在 `pre-compact-snapshot.sh` 寫的檔；本 hook 是觸發點，NEVER 把落盤全文印進 context。
# 判不出來的方向：source 不是 compact → 靜默；落盤檔不存在 → 只指 plan.md § 進度。

set -u
trap 'exit 0' EXIT

payload=$(cat 2>/dev/null) || payload=""

extract() {
  printf '%s' "$payload" |
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

[ "$(extract source)" = compact ] || exit 0
session=$(extract session_id | tr -c 'A-Za-z0-9._\n-' '_')
snapshot="${XDG_STATE_HOME:-$HOME/.local/state}/clade/precompact/${session:-unknown}.md"

if [ -f "$snapshot" ]; then
  printf '⤷ 剛壓縮：續做前先讀 %s 與 plan.md § 進度，在飛的 0-A／Workflow 照那裡接續\n' "$snapshot"
else
  printf '⤷ 剛壓縮（沒有 PreCompact 落盤檔）：續做前先讀 plan.md § 進度\n'
fi
