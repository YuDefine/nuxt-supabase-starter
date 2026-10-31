#!/usr/bin/env bash
# SessionStart hook — 把 gh shim 前置進本 session 的 PATH（W-2026-10-30-github-api-gh-fleet）。
#
# 防的失敗類別：2026-10-30 一個 pane 用臨時 python 腳本 16 併發逐 run 查 runs/<id>/jobs，
# 十分鐘把帳號共用的 core 5000/hr 打到 0，fleet 停擺 23 分鐘。gh-throttle 的帳號預算閘只擋改用它的自動化，
# session 裡臨時寫的迴圈、腳本直打 gh 完全繞過。寫進 $CLAUDE_ENV_FILE 後，之後每個 Bash 命令與它生出的
# 子行程（python subprocess 也算）找到的 gh 都是 shim：記帳、額度 <5% 擋非急件、單一 session 每小時上限。
#
# shim 住 clade home（~/offline/clade/vendor/scripts/gh-shim/gh），不跟著 consumer 投影：一台機器一份。
# 不在（cloud VM、還沒 clone）、CLADE_GH_SHIM=off、或沒有 CLAUDE_ENV_FILE 時靜默跳過（fail-open）。
set -u
[ "${CLADE_GH_SHIM:-on}" = off ] && exit 0
[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
shim_dir="${CLADE_GH_SHIM_DIR:-$HOME/offline/clade/vendor/scripts/gh-shim}"
[ -x "$shim_dir/gh" ] || exit 0
grep -qF "$shim_dir" "$CLAUDE_ENV_FILE" 2>/dev/null && exit 0
printf 'export PATH=%q:"$PATH"\n' "$shim_dir" >>"$CLAUDE_ENV_FILE" 2>/dev/null
exit 0
