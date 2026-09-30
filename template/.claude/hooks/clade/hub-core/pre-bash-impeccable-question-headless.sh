#!/usr/bin/env bash
# PreToolUse:Bash hook — headless 主機上擋直接開 impeccable 決策頁（block，exit 2）
#
# 觸發條件：tool_input.command 含 `serve-question`，且會開 server（帶 `--start`，或帶
#           `--payload` 而沒帶 `--update`），且 hook 行程看不到 DISPLAY／WAYLAND_DISPLAY。
# 行為：exit 2，stderr 指向 vendor/scripts/impeccable-tailnet-question.ts。
#
# 為什麼要擋：沒有 DISPLAY 時 serve-question 印 `no browser detected … use the structured
#   question tool instead` 就不開 server，agent 照提示退回文字提問，方向回合丟掉卡片、comp、
#   reroll；而人其實在 tailnet 另一台裝置上開得了頁面。就算帶 IMPECCABLE_QUESTION_FORCE=1
#   手動開，server 只綁 127.0.0.1 且檢查 Host，`tailscale serve` 直接反代回 403；
#   探測時打 heartbeat 還會把這一輪永久判成頁面已關。三個坑腳本都處理掉了，
#   所以攔在「要開頁的那一刻」，而不是等 no-browser 輸出出現之後再提示。
#   全文：specs/truth/impeccable-question-page.md
#
# 放行：--wait／--update／--schema（不開新 server）、執行那支腳本的那一段、有 DISPLAY 的主機。
# 逃生門：人就在這台主機的桌面前時，命令前綴或 env 帶 CLADE_ALLOW_IMPECCABLE_LOCAL=1。
#
# fail-open：無 jq／解析失敗 → 靜默 exit 0。

set -uo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0

case "$cmd" in
  *serve-question*) ;;
  *) exit 0 ;;
esac

# 腳本自己那一段（到下一個分隔符為止）剝掉再判；只是在引數或 echo 裡提到腳本名不算。
# 剝完仍有會開 server 的 serve-question，就還是直接開頁。
cmd=$(printf '%s' "$cmd" | sed -E 's#[^;&|[:space:]]*impeccable-tailnet-question\.ts[^;&|]*##g')
case "$cmd" in
  *serve-question*) ;;
  *) exit 0 ;;
esac

opens_server=0
case "$cmd" in
  *--start*) opens_server=1 ;;
  *--payload*)
    case "$cmd" in
      *--update*) ;;
      *) opens_server=1 ;;
    esac
    ;;
esac
[ "$opens_server" = "1" ] || exit 0

if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
  exit 0
fi

if [ "${CLADE_ALLOW_IMPECCABLE_LOCAL:-}" = "1" ] ||
  printf '%s' "$cmd" | grep -qE '(^|[;&|(]|env )[[:space:]]*CLADE_ALLOW_IMPECCABLE_LOCAL=1[[:space:]]'; then
  printf 'impeccable question gate: CLADE_ALLOW_IMPECCABLE_LOCAL=1 — 放行\n' >&2
  exit 0
fi

cat >&2 <<'MSG'
impeccable question gate: 這台主機沒有 DISPLAY／WAYLAND_DISPLAY，直接 serve-question 開不出給人用的決策頁。
NEVER 因為 no browser detected 就退回結構化文字提問。改用（在同一個 repo 根目錄）：

  node ~/offline/clade/vendor/scripts/impeccable-tailnet-question.ts start --payload <file>

它會強制啟動 serve-question、起 Host 改寫代理、掛 tailscale serve、只用 GET /next-status 驗證，
印出 TAILNET URL 後迴圈等答案並收乾淨；沒有 tailscale 時印 SSH -L 轉埠指令。
Bash tool 會在 10 分鐘逾時：用 run_in_background 跑，或 start --no-wait 後在背景跑 wait。
reroll／followup：exit 10 代表 session 保留，接著跑 update --payload <next>。

用法全文：vendor/snippets/impeccable/README.md § headless／遠端主機的決策頁
人就在這台主機桌面前：命令前綴 CLADE_ALLOW_IMPECCABLE_LOCAL=1 放行。
MSG
exit 2
