#!/usr/bin/env bash
# UserPromptSubmit hook — Charles 個人縮寫（\do-all / \nx / \my / \sg / \bp）出現時，
# 把對應規約的一行 pointer 注入 context（採用即時強化；規約全文在 ~/.claude/CLAUDE.md，
# 本 hook NEVER 複製全文，只補「那一刻」的送達）。
#
# 縮寫是純文字慣例，可出現在訊息任何位置。零命中 → 零輸出（無背景噪音）。
# 通道：hookSpecificOutput.additionalContext（exit 0；UserPromptSubmit 的官方注入通道）。
# jq 缺 / 解析失敗 → silent exit 0（fail-open）。

set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // ""' 2>/dev/null) || exit 0
[ -n "$PROMPT" ] || exit 0

# 邊界：縮寫後面不能緊接英數（\bp 不匹配 \bpx；\my 不匹配 \myfile）。dash 為 \do-all 保留。
hit() { printf '%s' "$PROMPT" | grep -qE "$1"; }

MSG=""
append() { MSG="${MSG:+$MSG
}$1"; }

if hit '\\do-all([^[:alnum:]-]|$)'; then
  append '⛔ 偵測到 \do-all — MUST 立刻 Skill invoke: do-all 再開工（三步流程 + Red Flags 在 skill 裡，NEVER 憑記憶跑）。主線是預設，外派要講得出命中哪一條外派清單。'
fi
if hit '\\nx([^[:alnum:]-]|$)'; then
  append '📍 偵測到 \nx — 先判收工再作答：命中收工 predicate → Herdr 內 invoke /handoff relay <task pointer>（多件可平行則 /handoff fanout）；不在 Herdr（Cursor）走 create-only dispatch（--cwd --label --prompt-file，不要 --relay）。否則給 2–4 個排序過的選項（每項一句後果）。NEVER 給排程型建議（N 週後再回頭）。'
fi
if hit '\\my([^[:alnum:]-]|$)'; then
  append '📍 偵測到 \my — MUST 立刻 Skill invoke: my 再開工。佇列一律走 node ~/offline/clade/vendor/scripts/flow/flow.ts pending，NEVER 自己 grep 任何檔（spine 上 flow ask 開的題 grep 不到）。編號依 §QnX：只有「要我拍板」那類編 Qn，其餘 bullet。末尾現況量測 MUST 當下實跑。'
fi
if hit '\\sg([^[:alnum:]-]|$)'; then
  append '✅ 偵測到 \sg — 採納剛才那一個建議直接執行，不再回頭確認。範圍只到該建議：permission 提示與其他 gate 照常；建議含多選項且未指名 → 問哪一個。正在等答的 gate 視為已回答「可以」。'
fi
if hit '\\bp([^[:alnum:]-]|$)'; then
  append '📥 偵測到 \bp — MUST 走 /bp skill：判落點 → 回報「落點 + 一句理由 + 要動的檔」→ 等確認才寫入，NEVER 自行落地。'
fi

[ -n "$MSG" ] || exit 0
jq -n --arg ctx "$MSG" \
  '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}}'
exit 0
