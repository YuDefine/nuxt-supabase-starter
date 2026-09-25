---
description: claude native dispatch and watch controls；具名模型與 UI 角色由共通 routing table 決定
paths: ['openspec/changes/**/tasks.md', 'openspec/changes/**/design.md', '.claude/agents/**', 'screenshots/**/progress.json']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/agent-routing.pi-watch-protocol.md; edit canonical source -->

<!-- clade-targets: claude -->

# Claude native dispatch and watch controls

The Claude native delegation entry is `Agent`; its async owner may use `run_in_background`. The keepalive mapping is `TaskOutput(block=false)`, `ScheduleWakeup`, and `TaskStop`, with terminal claim before result harvest. A blocked attended path uses `AskUserQuestion`; unattended mode packages the decision and stays blocked.

## Claude 委派的 model 檔位（決定層）

先依 [[agent-routing.routing-table]] 選角色與鏈；Claude child／subagent 只可用 Opus 5.5，effort 上限 medium。commit 0-A reviewer 固定 medium；`dispatch-fallback` 固定 low。配額或 runtime 不可用時，按表列鏈尾交 `dispatch-fallback` 或主線；Opus reviewer 不可用時 commit gate 保持未完成。

**NEVER** 把本節讀成「不確定時降檔比較省」。2026-09-24 起 Sonnet／Haiku 已禁用，舊的「原判 Sonnet」與「原判 Haiku」只代表歷史工作量分類，不能當派工目標；**NEVER** 用沒有來源的 per-model debit multiplier 估算節省比例。

### `general-purpose`／`Explore` 與 Pi 分流

非 UI、無 MCP 需求的事實表／掃描，以及 brief 已明確指定、可用獨立語意 gate 驗證的機械改寫，先依 Routing Table 判 Pi 列並走 `pi-dispatch.ts`。Pi 不可用時依該列的鏈尾處置；仍留 Claude 的工作顯式指定 `model: opus` 和適用 effort，不省略而繼承主線設定。判讀／治理型分析、需 claude.ai-connected MCP 或 user 指名的 Claude 工作同樣遵守 Opus 限制。

**First-hit 路徑**：已判定要派 Pi 的工作直接跑 `pi-dispatch.ts`，不為了拿 decision id 刻意先撞 `Agent` gate；dispatcher 會鑄 `self-dispatch` receipt。機械改寫須同時滿足 brief 已定規格、目標路徑已知、獨立語意 gate 足夠強、錯誤可低成本重派四條；不滿足就依 Routing Table 交合格 executor，不能退回禁用 model。

**PreToolUse:Agent gate**：Claude 主線呼叫 `Agent` 會建立 pending decision 並阻擋；照 [[agent-routing.pi-watch-protocol]] § Routing threshold 與 Claude Agent dispatch gate 的 receipt／waiver 流程結案，不在 prompt 寫自由文字 bypass。Pi 業務失敗或額度不可用時只沿該列 `next_step` 前進，鏈尾以 Routing Table 為準。終端 Claude subagent 顯式帶 `model: opus` 與允許的 effort。

### NEVER 降檔的形狀

- 輸出**本身**就是品質或安全 gate（review / 裁決 / 安全判定）
- 需要跨檔調解矛盾證據，或需要判斷「哪些 evidence 相關」
- 產出是**規約措辭**（理由見 [[agent-routing.dispatch-execution]] § Subagent 回報契約 關於措辭一致性那條）
- 輸出格式結構化**不構成**降檔理由：判準是下游有沒有語意 gate。同一條界線在 § Routing Table
  的 pi 檔位段已寫成 NEVER 行，本節適用同一條，**NEVER** 在這裡另立一套寬鬆版

### 為什麼是四條全中，不是「傾向降檔」

委派側的 model 組成、Opus 佔委派的比例、`agentType` 分佈都是 rolling window，
**判現況一律複跑** `node scripts/audit-session-context-budget.ts` 的「模型組成」與「委派 × agentType」
兩表，**NEVER** 引用任何寫死的百分比當現值。
**NEVER** 拿 `agentType` 表的分佈當委派整體的分佈（`(unattributed)` 佔大宗）——兩件量測邊界的
完整說明見 rationale § 四條全中而非「傾向降檔」。

## Claude bounded phases

### Claude-primary（在 apply 前的決策／探索階段，以下任一命中即留主線）

- **架構 / 設計決策、需求模糊**——先 plan mode 釐清，tasks.md 未定稿就還不是 apply residency
- **安全敏感** / 需 tight review loop、且尚未收斂成可執行 tasks 的 change
- **clade routing / 規則知識**的編輯
- **路徑未知的探索式 debug**

進入 apply 後，個別 phase executor 仍走 共通 Routing Table；那張表決定誰實作，不反向改寫 residency。

Design Review, UI planning and screenshot matching use Opus 5.5, with the GPT-5.6 Sol high fallback on the original row on actual failure. Nuxt UI/Content implementation uses Cursor Composer 2.5, Nuxt core uses GPT-5.6 Sol xhigh, other UI views use Opus 5.5 medium, and screenshot capture uses Pi Gemini 3.8 Flash.
