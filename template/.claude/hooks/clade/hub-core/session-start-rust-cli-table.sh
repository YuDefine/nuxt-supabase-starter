#!/usr/bin/env bash
# session-start-rust-cli-table.sh — SessionStart 常駐小表（≤ 5 行）：「要做 X 用 Y」，只列這台 PATH 上真的有的工具。
#   （規約與工具清單的 SoT：docs/rust-cli-tools.md）
#
# 型別：注入型
# 設計答案（hook-authoring `rules/提醒注入型的送達去重與噪音.md`）：
# - 送達通道：SessionStart stdout（同 session-start-disk-low-watermark.sh）。
# - 噪音預算：表身 ≤ 5 行（outline 一行＋四個工具各一行），每行一個工具；只列環境層接不到原名的工具
#   （ast-grep、sd、fd、jaq）＋ outline／md-section。outline／md-section 只認 clade 自己那份
#   （${CLADE_HOME:-$HOME/offline/clade}/scripts/，與 post-bash-rust-cli-hint.sh 同一個候選），印絕對路徑可直接照抄。
#   沒有任何一個工具可用 → 完全靜默。NEVER 列沒裝的工具（驗收：因本項造成的指令失敗為 0）。
# - 去重：不設 marker。本 hook 在 SessionStart matcher "" 群組，startup／resume／clear／compact 都會觸發；
#   小表是固定 ≤ 5 行的事實對照，重印的成本有上限（budget fixture 700 bytes），不值得為它維護跨事件狀態。
# - subagent：不適用（SessionStart 只在主線 session 觸發；子代理靠 PostToolUse 事件提示層）。
# - 措辭：事實對照表，不寫祈使句，不寫「ALWAYS FIRST」（codebase-memory-mcp 的教訓）。
# - 效果指標：measure-rust-cli-usage.ts 的 ast-grep／fd／sd／jaq 呼叫次數；14 天檢討時用量近 0 的列從本表拿掉。
# - 不蓋掉原名：sed／find／grep／jq 照舊；ast-grep 只用 `ast-grep` 這個名字（desk 的 `sg` 是 util-linux）。
#
# cloud VM（CLAUDE_CODE_REMOTE 有值）整支跳過：工具是個人層裝的，VM 沒有。fail-open：恆 exit 0。

set -uo pipefail
cat > /dev/null
case "${CLAUDE_CODE_REMOTE:-}" in '' | 0 | false) ;; *) exit 0 ;; esac

lines=()
SCRIPTS="${CLADE_HOME:-${HOME:-/nonexistent}/offline/clade}/scripts"
if [ -f "$SCRIPTS/outline.ts" ]; then
  line="大檔先看結構 → node ${SCRIPTS}/outline.ts <檔>，再 Read offset／limit"
  [ -f "$SCRIPTS/md-section.ts" ] && line+="；md 按節讀 → node ${SCRIPTS}/md-section.ts <檔> '<標題>'"
  lines+=("$line")
fi

command -v ast-grep >/dev/null 2>&1 && lines+=("結構搜尋／改寫程式碼 → ast-grep -p '<pattern>' -l ts（--json=compact 只取需要欄位）")
command -v fd >/dev/null 2>&1 && lines+=("依檔名找檔 → fd <樣式>（預設遵守 .gitignore，比 find 少 node_modules）")
command -v sd >/dev/null 2>&1 && lines+=("批次取代字串 → sd -F '<舊>' '<新>' <檔…>（-F 字面比對；不帶 -F 是 regex）")
command -v jaq >/dev/null 2>&1 && lines+=("處理 JSON → jaq '<filter>' <檔>（jq 語法子集，快）")
[ "${#lines[@]}" -gt 0 ] || exit 0
printf '工具對照（這台已裝）：\n'
printf '  %s\n' "${lines[@]}"
exit 0
