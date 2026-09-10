---
description: claude native dispatch and watch controls；具名模型與 UI 角色由共通 routing table 決定
paths: ['openspec/changes/**/tasks.md', 'openspec/changes/**/design.md', '.claude/agents/**', 'screenshots/**/progress.json']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/agent-routing.pi-watch-protocol.md; edit canonical source -->

<!-- clade-targets: claude -->

# Claude native dispatch and watch controls

The Claude native delegation entry is `Agent`; its async owner may use `run_in_background`. The keepalive mapping is `TaskOutput(block=false)`, `ScheduleWakeup`, and `TaskStop`, with terminal claim before result harvest. A blocked attended path uses `AskUserQuestion`; unattended mode packages the decision and stays blocked.

## Claude 委派的 model 檔位（決定層）

**Cursor runtime 先停：本節整節不適用。** 命中 § Runtime residency and native transport 的 session **NEVER** 走到本節挑 `Agent` / `Task` 的 Claude／Fable／Haiku 檔位。

上表管「派 pi 還是留 Claude」。本節只管**已決定留 Claude 的委派工作**該用哪個 model —— 這是
`Agent` / `Task` 的 `model` 參數，與 pi 的 `--model` 三檔位無關。

> **本節與 harness 預設對立，所以邊界要明寫**（完整論證見 rationale § 與 harness 預設對立）：本節
> **不**主張「委派都該指定 model」，只列**窮舉的**降檔 predicate——命中就指定 `model: 'sonnet'`，
> 一條都沒命中就照 harness 預設省略。**NEVER** 把本節讀成「不確定時降檔比較省」。

⚠️ **省多少配額 UNKNOWN**：訂閱內含配額的 per-model debit multiplier 官方未公布（同 § Routing Table
的 codex-pool 側警告）。**NEVER** 把「降 Sonnet 省 X%」寫進任何精算或對外敘述——降檔的已知收益只有
「同一份工作換更便宜的執行者」這個方向，倍率不可量化。

### 進本節前 MUST 先過 Routing Table（per [[agent-routing.dispatch-execution]] § Subagent 回報契約 第 4 條）

**每一個**「留 Claude」的判定都要講得出「Routing Table 沒把它 route 給 Pi」。非 UI 工作命中已 route 給 Pi 的類別 → 派 Pi，**NEVER** 走到本節挑 Claude 檔位。本節只處理判定後**仍留 Claude** 的殘集：需 claude.ai-connected MCP、判讀／治理型分析、user 明確指定、降級鏈接手。

### `subagent_type` 是 `general-purpose` 或 `Explore` 時，派工當下 MUST 先判 pi 可用性

**適用範圍就是這兩個字面值**，且非 UI、不需 MCP，產出屬下列任一：

- **(a) 事實表／掃描結果** —— 主線要消費它的回報
- **(b) brief 內已逐字指定的機械改寫（mutation）** —— 產出就是改好的檔案本身，沒有回報要消費。
  (b) 額外 MUST 兩項：改動有**硬 gate**（typecheck ／ test ／ lint 的 exit code）接住，且**可一鍵
  還原**（`git checkout`）。兩項缺一 → 不走本節，照原判派 Claude `sonnet`。**NEVER** 拿「沒有回報
  通道就不該給 pi」當把 (b) 退回 Claude 的理由——那是 dispatch 形狀，不是檔位判準。

**每一個**這種派工都 MUST 顯式帶檔位，**NEVER** 省略參數靜默繼承主線。`subagent_type` 是別的值時照下一節四條
predicate 走，**NEVER** 把本小節外推成「委派都該指定 model」。

| 可觀察 predicate | 檔位 |
| --- | --- |
| Pi可用（dispatcher未回exit 3／4） | 原判`sonnet` → `--model gemini --effort high`；原判`haiku` → `--model gemini --effort high` |
| Pi runtime機械不可用（exit 3） | 依watch-protocol判斷修runtime或顯式改派Claude；**NEVER** fallback到Codex CLI |
| Pi配額不可用（exit 4） | 走§ 配額耗盡時的fallback紀律，`sonnet`／`haiku` **顯式帶** |

**First-hit 路徑（正路，先於下面那道 gate）**：已判定要派 pi 的工作，**MUST 直接跑 `pi-dispatch.ts`**，**NEVER** 為了「先取得 decision_id」刻意呼一次 `Agent`。未帶 `--decision-id` 時 dispatcher 會自鑄一顆決策，寫 `trigger: 'self-dispatch'` receipt、ledger 記 `decisionOrigin: self-armed`——稽核紀錄與走 gate 的那條同樣完整，差別只在少一個 round trip。刻意先撞 gate 再補救，會把一筆本來就路由正確的 dispatch 記成 block 後的補救，讓「第一擊就派對」這個指標讀起來永遠是 0。

撞到下面那道 gate 時 **NEVER 讀成自己做錯了、流程壞了、或需要有人來解**：它是取證握手，訊息裡的 `decision_id` 就是給這次 dispatch 用的。照它給的指令跑完即可，**NEVER** 停下來反省或改問人。

**PreToolUse:Agent 機械 gate**：主線呼叫 `Agent` **一律**立即建立 `claude-agent-dispatch` pending decision 並阻擋，**不分 `subagent_type`、也不分 `model`**——省略 `model`（繼承主線）與明寫 Opus／Fable 同樣計入（判準是 default-deny：繼承主線正是**最貴**的委派形狀，TD-513）。**NEVER** 把例外理由寫進 Agent prompt 當作 bypass——gate 只認 decision receipt，不解析自由文字。

**撞到這道 gate、要決定怎麼結案之前，MUST 先讀 [[agent-routing.pi-watch-protocol]] § Routing threshold 與 Claude Agent dispatch gate**——正常結案的逐字 `pi-dispatch.ts` 指令與 effort 對照、四個具名 waiver、Gemini／Sol exit 2 的升級鏈與 exit 4 的配額鏈，都在那裡，**此處不複述**。

**本節路徑的 luna 准入（與 § Routing Table 五條連言無關）**：原判 `sonnet` 的委派 MUST 同時滿足兩項——(1) § MUST 指定 `model: 'sonnet'` 的四條 predicate 全中（複核，不是加碼）；(2) 未命中 § NEVER 降檔的形狀任一條。兩項都過 → 派 `--model gemini --effort high`，**NEVER** 因「gemini 較便宜」自行改回 `--model sol` 或退回 Claude `sonnet`。任一項不過 → 照原判派 Claude `sonnet`（顯式帶 `model`），**NEVER** `--model terra`。

**gemini 回 exit 2（業務 fail）→ 升 `--model sol` 同 effort 重派一次**；再 fail 才回 Claude `sonnet` subagent。exit 3／4 照 § 配額耗盡時的 fallback 紀律 與 watch-protocol 的 exit code 分流走，**NEVER** 記入品質判斷。

### MUST 指定 `model: 'sonnet'` 的 predicate（窮舉）

**每一個**同時滿足下列**四條**的委派工作都要指定，不是只處理其中最大的那一個：

1. 規格在 brief 內已明確，subagent 不需要裁決「該做什麼」
2. 目標路徑**已知且已列在 brief 裡**，不需要跨檔追蹤或探索未知路徑
3. 輸出的正確性有**獨立且夠強的語意 gate** 接住（主線複讀、test、既有 audit script）
4. 錯誤的修正成本 ≤ 重派一次

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

Design Review, UI planning and screenshot matching use Opus 5, with the GPT-5.6 Sol high fallback on the original row on actual failure. Nuxt UI/Content implementation uses Cursor Composer 2.5, Nuxt core uses GPT-5.6 Sol xhigh, other UI views use Opus 5 medium, and screenshot capture uses Pi Gemini 3.8 Flash.
