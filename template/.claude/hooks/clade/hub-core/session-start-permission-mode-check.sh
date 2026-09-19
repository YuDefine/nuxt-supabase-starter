#!/usr/bin/env bash
# SessionStart hook — Herdr pane 內的 session 沒有 bypassPermissions 就出聲。
#
# 防的失敗類別：bypass 是**啟動路徑**的性質（`cc` / `ccw` wrapper 帶
# `--permission-mode bypassPermissions` 與帳號路由 env），而裸 `claude` 是一條永遠存在、
# 零摩擦、零回饋的錯誤路徑。打錯的那次若沒有任何東西出聲，這個類別就會重演。
# 2026-08-19 實測：<consumer-h> 的 pane w6:p5 被手打 `claude` 起來，跑了 16 分鐘
# 沒有任何訊號，是外部觀察 /proc cmdline 才發現的。
#
# 本 hook **只偵測、不修正**：permission mode 是啟動 flag，session 中途改不了；靜默升權
# 也不該做。輸出走 stdout 注入 context，agent 讀到就主動告知 user 重開。
#
# 不報的情況（fail-open）：非 Herdr pane、work-loop runner child（刻意用 acceptEdits）、
# 找不到 claude 祖先行程、/proc 與 ps 都讀不到祖先。

set -uo pipefail

cat > /dev/null

# 只在 Herdr pane 內判斷——pane 是 dispatch / relay 的落點，也是手打 claude 的地方。
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
# work-loop runner child 刻意跑 acceptEdits，per runner.sh --permission-mode acceptEdits。
[ "${WORK_LOOP_RUNNER_CHILD:-}" = "1" ] && exit 0
if [ ! -r /proc/self/stat ] && ! command -v ps >/dev/null 2>&1; then
  exit 0
fi

ancestor_ppid() {
  local pid="$1"
  if [ -r "/proc/$pid/stat" ]; then
    awk '{print $4}' "/proc/$pid/stat" 2>/dev/null
  else
    ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]'
  fi
}

ancestor_cmdline() {
  local pid="$1"
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null
  else
    ps -o command= -p "$pid" 2>/dev/null
  fi
}

# 沿 PPID 鏈往上找 claude / claudex 祖先。
# Linux /proc 的 argv0 常是 `/usr/local/bin/claude`；Darwin 對 shebang script 的
# `ps -o command=` 第一個詞是 interpreter（`/bin/sh`），腳本路徑在第二個詞。
pid=$$
cmdline=""
for _ in 1 2 3 4 5 6 7 8; do
  ppid="$(ancestor_ppid "$pid")" || break
  [ -n "$ppid" ] && [ "$ppid" != "0" ] || break
  raw="$(ancestor_cmdline "$ppid")" || break
  [ -n "$raw" ] || break
  found=""
  for word in $raw; do
    case "${word##*/}" in
      claude|claudex) found="$raw"; break ;;
    esac
  done
  if [ -n "$found" ]; then
    cmdline="$found"
    break
  fi
  pid=$ppid
done

[ -n "$cmdline" ] || exit 0
case "$cmdline" in
  *bypassPermissions*) exit 0 ;;
esac

cat <<WARN
⚠️ 本 session 不在 bypassPermissions：Herdr pane ${HERDR_PANE_ID} 的 claude 行程沒有帶
   \`--permission-mode bypassPermissions\`，多半是有人在 pane 裡直接打了裸 \`claude\`
   而不是 \`cc\` / \`ccw\`。

   裸 \`claude\` 缺的不只 permission mode，還有 wrapper 帶的帳號路由
   （\`CLAUDE_CONFIG_DIR\`、\`env -u ANTHROPIC_*\`）—— 這個 session 可能連帳號都是錯的。

   permission mode 是啟動 flag，本 session 改不了。MUST 主動告知 user：
   要 bypass 就結束本 session、在該 pane 改用 \`cc\`（個人）/ \`ccw\`（工作）重開。
   GPT／Codex 工作改用 \`cx\`；\`ccx\` 已退役，不再是可重開入口。
   刻意要非 bypass session 則忽略本則。
WARN
exit 0
