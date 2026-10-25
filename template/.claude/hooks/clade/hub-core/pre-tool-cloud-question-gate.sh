#!/usr/bin/env bash
# PreToolUse:AskUserQuestion|EnterPlanMode hook — cloud session 擋會停下來等人的互動式提問（block，exit 2）
#
# 觸發條件：CLAUDE_CODE_REMOTE 非空且不是 0／false（cloud VM；判定與 SessionStart hook 同一條，
#           實測見 specs/plans/W-2026-10-07-clade-cloud-hook-remote-guard/evidence/README.md），
#           且 tool_name 是 AskUserQuestion 或 EnterPlanMode（後者結束時要人核准計畫，同樣卡在等人）。
# 行為：exit 2，stderr 叫 session 把題目寫成 GitHub 上的 `BLOCKED:` 回報，然後繼續做不依賴該決策的部分。
#
# 為什麼要擋：cloud session 沒有人在現場，主持者 SendMessage 給它是單向的；停在選單上只會在 ListAgents
#   顯示 waiting on a human，題目本身誰都讀不到。GitHub 是 cloud session 唯一讀得回來的出口；一律開 issue——
#   watch 只對 cloud-dispatch record 擁有的 branch 讀 PR comment，claude.ai／routine 開的 session 只有 issue 讀得到，
#   watch 依同一套 `BLOCKED:` 類別判讀（vendor/scripts/lib/cloud-orphan-blocked.ts）。全文：rules/core/session-cloud-unattended.md
#
# 判別只看「是不是 cloud 環境」，NEVER 看是不是主持者派的／有沒有 cloud-dispatch record（claude.ai、routine 開的一樣擋）。
# 放行：本機 session（沒有 CLAUDE_CODE_REMOTE）、其他工具。
# 唯一逃生口：該 session 明確設 CLADE_ALLOW_CLOUD_QUESTION=1（預設關閉；派工 brief／routine NEVER 自動帶上）。
#
# fail-open：讀不到 tool_name 時照 matcher 判（hooks.json 只把上述兩個工具送進來）。

set -uo pipefail

case "${CLAUDE_CODE_REMOTE:-}" in '' | 0 | false) exit 0 ;; esac
[ "${CLADE_ALLOW_CLOUD_QUESTION:-}" = "1" ] && exit 0

input=$(cat)
tool=$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')
case "$tool" in
  AskUserQuestion | EnterPlanMode | '') ;;
  *) exit 0 ;;
esac

cat >&2 <<'MSG'
cloud question gate: cloud session 沒有人在現場，停在提問／計畫核准上沒有人會回答（主持者 SendMessage 是單向的）。
NEVER 再試互動式提問。改成在 GitHub 回報（cloud VM 沒有 gh，用這個 session 的 GitHub 工具）：
  在這個 repo 開一張 issue（標題＝第一行；已有 PR 也開 issue，PR comment 沒有 cloud-dispatch record 就沒人讀）。內文：
    BLOCKED: <needs-coordinator|needs-charles|environment> <一句原因>
    Session: <這個 session 的標題>
    Branch: <目前 branch>
    Work: <work id，沒有就省略>
    ## 題目
    <題目原文>
    ## 選項
    - <選項>（推薦）：<這樣做會怎樣>
    - <選項>：<這樣做會怎樣>
回報後繼續做不依賴這個決策的部分；必須先決定才能動的，照最保守的選項做或停在那一步，在最後回覆寫明。
全文：rules/core/session-cloud-unattended.md（consumer 在 .claude/skills/clade-session-work/rules/）
MSG
exit 2
