---
description: agent 與 user 的 handoff 邊界全文——目標動作失敗證據、session-scoped latch／claim／lease、四步判準與 red flags；常駐 [[agent-routing]] 只留 Iron Law 與本檔 MUST-Read
paths: ['HANDOFF.md', 'tasks/**', 'specs/**', '.clade/**']
---
<!-- Clade native rule; source: rules/core/agent-routing.agent-boundary.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# Agent Routing — agent / user boundary

> 本檔是 [[agent-routing]] § 停下來要人做之前 的 path-scoped detail。常駐層保留「兩條全中才准 handoff」；本檔補實際判定與反開脫，**NEVER** 因本檔未自動命中就放寬常駐 Iron Law。

## 兩條全中才准交給人

1. **目標動作本身已實際嘗試並失敗**，且有逐字輸出（命令、exit code、訊息）。相鄰探測、相似命令或同一 gate 擋過別的動作，都不是目標動作的失敗證據。
2. **失敗原因是人類專屬能力**：人的憑證／生物辨識、外部系統授權點按、商業／產品決策，或既有規約明文要求的人類不可逆 gate。

缺一就自己做。沒有規約覆蓋的新情境，預設仍是 agent 自己處理，不能用「規約沒寫」升級 user。

## Session-scoped 動作

綁定本 session 身分的 routing latch、session claim、verification lease 與持有鎖，其他 session 或 user 不能代勞。遇到這類動作，唯一合格的第 1 步是本 session 實際嘗試；不能把「我自己解不開」當失敗證據。

## Red flags

看到「請你跑這行就好」「我用 X 驗證過所以 Y 也不行」「這是死鎖／雞生蛋」「規約沒寫先問人」「別 session 造成所以交回 user」時，停下來改跑**目標動作本身**，並查 ownership、session、process 與適用 adapter。跨 session 衝突走協調入口，不用 structured user-input surface 假裝成 user gate。

## 已有領域出口

dev server、commit、Herdr transport、review-gui、manual-review 的自救與 user-only terminal conditions，依 [[proactive-skills.dev-server-spawn]]、[[commit.detail]]、[[session-tasks.operations]]、[[review-gui-surface]] 與 [[manual-review.data-readiness]]；本檔不另造第二套流程。
