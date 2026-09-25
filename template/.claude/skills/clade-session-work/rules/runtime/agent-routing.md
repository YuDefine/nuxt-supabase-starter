<!-- Clade native rule; source: adapters/claude/instructions/rules/core/agent-routing.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude native routing transport

When the current Claude tool catalog exposes the following surfaces, use them for the selected Claude session; the adapter declaration alone does not prove availability. `Agent` is the delegation entry; `run_in_background` is the async owner mode. `AskUserQuestion` is the structured user decision surface, and `TaskOutput(block=false)`, `ScheduleWakeup`, and `TaskStop` are the task status, wakeup, and cancellation controls. The common scope, approval, evidence, model, and fallback predicates remain binding.

顧問／分析型 subagent 的產出通道（TD-679）：`SendMessage` 沒有時效保證，`Agent` tool 的最終輸出才有。宣告「這支 agent 沒有產出」之前 **MUST** 先讀它的 transcript（`~/.claude/projects/*/<session-id>/subagents/*.jsonl`）；`ListAgents` 的 `idle` 不是產出訊號。

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

## Claude residency carrier

The Claude session is the primary carrier for the common source's Claude-primary predicate. Native delegation remains bounded by the common Routing Table and completion claim; it does not create a new routing exception.

## Claude 載體

Claude Code 開 session／subagent 的寫法：短期、本 turn 收得回的 Claude 工作用 `Agent` tool（前景，`model: 'opus'`），NEVER 為了這類工作開 Herdr pane。Herdr `--launcher cc`／`ccw` `--model opus --effort medium`（上限 medium，helper 對 Opus `high` 回 `usage_error`）只留給 successor、長時間 background、必須隔離的環境，或叫不出 subagent 的 runtime。**NEVER** `ccg`／`ccx`——gateway 把 `opus` 映射成 Grok／GPT。commit 0-A reviewer：`claude-review-safe.sh prepare medium` → `Agent`（`subagent_type: commit-0a-reviewer`）→ FINALIZE；叫不出 subagent 才跑無子命令的 `claude-review-safe.sh medium`。
