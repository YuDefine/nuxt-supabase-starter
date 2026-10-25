---
description: Routing Table 的對照資料層——工作類別 × 由誰執行（model・effort）× 為什麼的逐列表，以及 effort 檔位對照表。跨列的硬禁令與判準也在本檔（§ Pi 派工的 workspace capability、§ Routing 硬禁令）。**單純「要派工」不會自動載入本檔**：查表決定 model／effort 的那一刻，MUST 依 [[agent-routing]] 檔頭的強制指針主動 Read；改本表任一列或動 pi-routing-*.ts / pi-dispatch.ts 時 path-scoped 載入
paths:
  [
    '.claude/rules/agent-routing.md',
    'rules/core/agent-routing.md',
    'vendor/scripts/pi-routing-policy.ts',
    'vendor/scripts/pi-routing-gate.ts',
    'vendor/scripts/pi-dispatch.ts',
  ]
---
<!-- Clade native rule; source: rules/core/agent-routing.routing-table.md; edit canonical source -->
<!-- clade-targets: claude,agents -->
<!-- clade-adapters: claude -->

# Agent Routing — Routing Table（對照資料層）

Claude Code 與 Pi 共用本表的工作角色（Codex runtime 已於 2026-10-18 移除）。

> 本檔是 [[agent-routing]] § Routing Table 的下推對照表。**判準留在該節**（合法 model 值、
> workspace mutation 的 admission、`--route`／`--tier-basis`／
> `--table-row` 的記帳義務、以及每一條硬禁令）；本檔只回答「這類工作查出來是哪個 model、哪個
> effort、為什麼」。取證與跑分在 [[agent-routing.routing-table-rationale]]。
> 機械 SoT 是 `vendor/scripts/pi-routing-policy.ts` 的 `TABLE_ROW_POLICIES`／`ROW_CHAINS`／
> `DELEGATE_SUB_CHAIN`／`NATIVE_TABLE_ROW_POLICIES`／`chainTerminal()`——本表與它 MUST 同一個 commit 一起改。

## 禁用（Charles 2026-09-24；GPT 全面退場 2026-09-29；Gemini 退場、Haiku 5.5 開放 2026-10-08；xAI 退場 2026-10-21）

**NEVER** 派下列任一 model，任何列、任何 fallback、任何「額度耗盡備援」都一樣：

| 禁用 | 備註 |
| --- | --- |
| **所有 GPT model**（GPT-6 Sol、Astra、Luna、`luna-cursor`、`terra`） | Charles 2026-09-29「全面捨棄 GPT 系列」。Pi 的 `sol` 進 `RETIRED_MODEL_TIERS`；Herdr `--launcher cx` 已移除（見下方 Codex runtime 列）；`--tier-basis adjudication`（綁 sol）在 Pi 退場，改走 `implementation-decision`；`codex-review-safe.sh` 已刪除 |
| Claude Fable 5.1 | **所有用途**，含原 0-A 額度耗盡備援格 |
| Claude Haiku 4.5 以下、Sonnet 5 以下 | Sonnet **5.5** 只准坐下表標它的列與 § delegate-sub 的兩個接手點（2026-09-29），其餘 sonnet 等級委派仍走 § delegate-sub 鏈；Haiku **5.5** 只准坐 § Haiku 5.5 的席位（`code-locate`，2026-10-08） |
| **Gemini 3.8 Flash**（Pi `gemini`、`google-gemini-cli`） | Charles 2026-10-08：訂閱到期、暫不續訂。`pi-dispatch.ts` 對 `gemini` 進 `RETIRED_MODEL_TIERS`；原 Gemini 首跳的列改 Grok 4.7 xhigh 首跳（Grok 也已於 2026-10-21 退場，見下方 xAI 列），`code-locate` 改 native Haiku 5.5；`--tier-basis five-conjunct`（綁 gemini）退場。續訂時改回 `pi-routing-policy.ts` 一處 |
| **Codex runtime**（Herdr `--launcher cx`） | Charles 2026-10-08 訂閱到期；2026-10-18「Codex 相關東西本來都該移除」→ 已移除（W-2026-10-18-codex-runtime-removal）：`cx` launcher、`.codex/` 投影、`codex-review-safe.sh` 都刪了，`--launcher cx` 當已移除 launcher 拒收。`.agents/skills`、根目錄 `AGENTS.md` 因 Pi／Devin 在讀而保留。要復用從 git 歷史還原 |
| Cursor Composer 2.5 | 原 `ui-implementation` 列併入 `ui-view-implementation` |
| **Cursor 池與 Cursor runtime**（`grok-cursor`、`grok`〔`grok-cursor` 的舊別名〕、`luna-cursor`、任何 `*-cursor`／`cursor/*` model） | Charles 2026-10-03 拍板 Cursor 全面退場（Codex 隨後於 2026-10-18 移除，runtime 只剩 Claude Code）。`pi-dispatch.ts` 對 `grok-cursor` 進 `RETIRED_MODEL_TIERS`、對其餘 `*-cursor`／`cursor/*` 依形狀拒收（exit 1）；Herdr `--launcher cursor`、`--model` 帶 Cursor 池 model 拒派；接手的 `grok-xai` 池也已退場（見下一列） |
| **xAI Grok**（Pi `grok-xai`、`xai/grok-4.7`；Herdr `--launcher grok`） | Charles 2026-10-06 退訂（「codex, grok, cursor 我目前都退訂了」），2026-10-21 落實（W-2026-10-21-grok-xai-retired-model-tiers-claude）。`pi-dispatch.ts` 對 `grok-xai` 進 `RETIRED_MODEL_TIERS`、`MODEL_TARGETS` 清空；`--launcher grok` parse 時 usage_error。原 Grok 首跳的列與 delegate-sub 的鏈都清空，首跳＝原鏈尾（見 § effort 與執行載體）。續訂時改回 `pi-model-targets.ts` 的 alias 與 `pi-routing-policy.ts` 的 `ROW_CHAINS`／`DELEGATE_SUB_CHAIN` |
| Devin Fusion | Devin 只剩 SWE-2 Max 一格，且是任意列的**可選**載體（見下） |
| `terra` | 2026-08-11 起禁用，不變 |

**Pi 派工的 model 維合法值**：無（2026-10-21 xAI 退場後 Pi 沒有可派 model）。`pi-dispatch.ts` 對上表任一 tier 在解析 model 之前就 exit 1；Pi 列的工作一律由該列鏈尾載體直接承接。

## effort 與執行載體

**effort 跟著 model 走，不跟著列走**（`TIER_EFFORT`／`CLAUDE_MODEL_EFFORT`）：Claude Opus 5.5 預設 `medium`；**Claude Sonnet 5.5 一律 `high`**；**Claude Haiku 5.5 一律 `low`**。任何一跳的 effort 與此不符，dispatcher exit 1。

**Sonnet 5.5 為什麼是 `high`（Charles 2026-09-29）**：`high` 是它自己的 API 預設（對稱於 Opus 5.5 用它自己的預設 `medium`）。官方「agentic coding 從 `medium` 起跳」的依據是 aggregate eval，本規約禁止拿 aggregate 跑分推導檔位（[[agent-routing.routing-table-rationale]]）；它接手的是原 Sol xhigh 的列，model 與 effort 同時降會疊加；官方也寫明低 effort 較常沒跑檢查就回報完成，正衝突於實作列的交付要求。`xhigh`／`max` 不開。**要降 `medium` 先補量測**：同一份真實 brief 各跑 ≥5 次，比「回報前有沒有跑真的檢查」與 commit 0-A findings 數。

**Sonnet 5.5 的載體**：in-process 用 `sonnet-implementer` subagent（frontmatter 釘 model 與 effort；brief MUST 含 `routing-row: <列名>` 一行，routing gate 依它放行）——`general-purpose` 加 `model: sonnet` 會繼承 session effort，不是合格載體；Herdr 用 `cc`（池入口，見下方 § Claude 帳號池）child `--model claude-sonnet-5-5 --effort high`（`sonnet` 別名會被釘到 5.5）。cloud session 也是合格載體：`cloud-dispatch.ts` 依列逐件帶 `--model claude-sonnet-5-5 --effort high`（旗標蓋過 repo 釘選，2026-10-06 實測），走不走 cloud 看內容適不適合，判準見 [[agent-routing.dispatch-execution]] § Cloud session 載體。Sonnet 以安全分類器拒答（`stop_reason: refusal`、Claude Code 的 Usage Policy 拒答訊息、空產出）**不算品質失敗**，直接交主線。

**Opus 卡住升 `high`（Charles 2026-09-28）**：同一問題已在 `medium` 失敗一次、或修法只修到一層，**且**有可跑的檢查（測試、指令、可重現步驟）時，下一次 Claude child 可以開 `high`——`herdr-session-handoff.ts --tier-basis stall-escalation --retry-of <前一次 medium 的 label> --effort high`。缺 `--retry-of`、或 basis 不是 `stall-escalation` 的 `high` 一律拒絕；**一次 medium 只換一次 high**：同一個 `--retry-of` label 已經開過一次 `high`（不論那次被 reclaim 或 controlled-stop 收掉）就拒絕，要再升級必須先有一次新的 medium 失敗；`max` 任何 basis 都開不了。**NEVER** 用「這題很難」「這是裁決」代替前一次 medium 失敗的事實。

**Pi 列的首跳＝鏈尾載體（2026-10-21 起）。** `grok-xai` 退場後 `ROW_CHAINS` 七列與 `DELEGATE_SUB_CHAIN` 都是空鏈，`chainTerminal()` 就是第一個載體：`web-search`／`mechanical-fanout`／`read-heavy-scan`／`notion-ops`／`screenshot-review-verify`／`copywriting-draft` → `dispatch-fallback` subagent（Claude Opus 5.5（effort: low））；`version-upgrade-research` → 主線。routing gate 仍對 WebSearch／WebFetch、Agent 委派、`read-heavy-scan`／`mechanical-fanout` 門檻武裝 decision，block message 印 `[carrier]`：**直接派鏈尾載體的那次 Agent 呼叫本身就解掉該 decision**（receipt `fallback-authorized`、reason `pi-chain-retired`）；`pi-routing-gate.ts fallback --reason pi-chain-retired` 不收。web 的 `user-explicit-mainline` waiver 照舊。

**執行鏈的「→」只在 provider／quota／runtime 不可用時前進**；quality／test failure 不前進。**鏈走完之後由誰接手**看下表的「鏈尾」欄：`dispatch-fallback` subagent（Claude Opus 5.5（effort: low），frontmatter 固定；讓主線不吞原始輸出），或主線自己做（主線是 Sonnet 時的語意見 § 主線 residency）。**NEVER** 回報 blocker 當鏈尾，也 **NEVER** 改派禁用 model。

## 判不進任一列時

工作對不上下表任何一列 → **主線自己做**；主線是 Claude Opus 5.5（effort: medium）時就是它，主線是 Sonnet 時照 § 主線 residency 交 Opus。**NEVER** 因為表上沒有你想派的模型就自己挑一個，也 **NEVER** 填 `--route manual` 去蓋掉一個從沒發生過的判定——`manual` 是政策成功指標的分母，填錯讀起來是假陰性而不是缺資料。

## 主線 residency（誰當主線；Charles 2026-09-29）

本表其他地方寫「主線」時指的是**當下這條主線 session**，它不一定是 Opus。席位：

| 主線在做什麼 | 主線 model |
| --- | --- |
| 主持（coordinator，含繼任 relay） | Claude Opus 5.5（effort: medium），固定；不開 Sonnet、不升 high（`coordinator` skill § 主持者的 model，helper 機械擋） |
| clade 標準層、規約撰寫（`dotclaude-authoring`）、跨 repo 裁決、commit 0-A 相關 | Claude Opus 5.5（effort: medium） |
| 範圍已定稿的實作 session（plan／brief 已定案，工作落在 Sonnet 四列） | 可以 Claude Sonnet 5.5（effort: high）起手；**NEVER** 降 medium |

Sonnet 主線的缺口，逐條補：

1. **鏈尾「主線」與判不進任一列**：工作落在 Sonnet 四列範圍內 → Sonnet 主線自己做。其餘（判讀、計畫、規約、判不出列）→ 唯讀判斷派 `opus-advisor` subagent（省略 `model`；frontmatter 釘 Claude Opus 5.5（effort: medium））當顧問，改檔交 Opus 5.5（effort: medium）child。**NEVER** 由 Sonnet 主線自己吞下 Opus 列的工作。
2. **Sonnet 列品質失敗的「小修」**：主線是 Sonnet 時不由主線做（會繞回同一個 model），改派 Opus 5.5（effort: medium）child，`--tier-basis quality-escalation --retry-of <label>`。
3. **必須叫 Opus 的時刻**：定稿措辭（規約、對外文字、PR 描述之外的交付文字）、方案分歧與根因裁決（全域 § 分歧仲裁的顧問在 Sonnet 主線改走 `opus-advisor`）、判讀驗收 subagent 的回報（哪些證據相關、算不算通過）、session gate（收工判定、scope verify、readiness 判定）。Sonnet 主線到這些時刻 **MUST** 派 `opus-advisor` 或交 Opus child，**NEVER** 自己下結論。**NEVER** 派 `Plan`（`model: 'opus'`）：subagent 呼叫沒有 effort 參數，沒釘 effort 的 subagent 繼承主線的 high，等於開 Claude Opus 5.5（effort: high）；routing gate 擋。
4. **refusal**：主線是 Sonnet 時碰到安全分類器拒答（`stop_reason: refusal`、Usage Policy 拒答訊息），**MUST** 以 `/handoff relay --model opus --effort medium` 開 Opus 接手，**NEVER** 改寫問法重試。
5. **額度**：Sonnet 與 Opus 同一池、per-model 倍率 UNKNOWN（rationale）。本規約 **NEVER** 寫「省多少」，也不以省額度當選 Sonnet 主線的理由；理由只有「範圍已定稿、是實作」。

commit 0-A 不受主線是誰影響：reviewer 永遠是 fresh-context Opus 5.5（effort: medium）（`code-review-opus`）。

## Workflow 的 Sonnet `agent()`（2026-09-29）

Workflow script 的 `agent()` 可以用 Sonnet 5.5 做改檔的工作，**三條全中**才用：工作要改檔；有機械驗收（測試、型別、lint、可跑的檢查）；最終結果由 Opus 或主線把關。

| 場景 | Sonnet effort |
| --- | --- |
| 大量同形改寫（同一個 repo 內）、平行修紅測試、多候選實作由 Opus 評選 | `high` |
| 文件草稿 | `high`；`medium` **待量測**（plan W-2026-09-29-coordinator-model-sonnet-residency-plan § D，量完才開） |

- **跨 repo 的散播不走 Workflow**：`agent()` 沒有工作目錄參數，只能在主持者 cwd 的 repo 開 `isolation: 'worktree'`。同一個 fix 散播到多個 repo、consumer 的件 **NEVER** 進 Workflow，一律走 coordinator skill 的 fanout 腳本（每個 repo 一個 pane；clade home 限定）。
- **不交給 Sonnet、也不降檔**：review、根因、方案取捨、規約措辭、「哪些證據相關」。這些 `agent()` 用 Opus（inline `model: 'opus', effort: 'medium'`）或留給主線。
- **現有的掃描、抽取類 Pi 列不改走 Sonnet**：它們的載體是 `dispatch-fallback`（Claude Opus 5.5（effort: low）），不是 workflow 的 Sonnet `agent()`。
- **形狀**（routing gate 對 Workflow tool 機械擋）：每個 Sonnet `agent()` 的 opts **inline** 寫 `model: 'sonnet'`（或 `claude-sonnet-5-5`）與 `effort: 'high'`，**NEVER** 省略 effort（會繼承 session）；prompt 帶一行 `routing-row: <列名>` 指回 Sonnet 四列之一，不另開 workflow 專用列。`agentType: 'sonnet-implementer'` 的 frontmatter 已釘 high，可省 effort。model 放在變數或共用 opts 常數裡的寫法 gate 讀不到，一律拒。
- **Opus `agent()` 也 MUST inline 寫 effort**（`'medium'`；`'high'` 只在全域 § effort 例外成立時）：`agent()` 沒寫 effort 就繼承主線，Sonnet 主線（high）上等於開 Claude Opus 5.5（effort: high）。主線是 Sonnet 時，省略 `model` 的 `agent()` 繼承 Sonnet，gate 當 Sonnet `agent()` 判並要求寫明 model。

## Haiku 5.5 的席位（Charles 2026-10-08）

Claude Haiku 5.5（`claude-haiku-5-5`）只坐 `code-locate` 一列：in-process `haiku-locator` subagent（Read／Grep／Glob，frontmatter 釘 model 與 effort，省略 `model`）。brief MUST 有 `routing-row: code-locate` 行（routing gate 機械擋）；回覆 MUST 交 `node vendor/scripts/verify-code-locate.ts --root <repo> <reply.json>` 複驗，exit 非 0 整份作廢。

- **量測**：4 題單檔定位／逐字引文 brief 各 5 次，Claude Haiku 5.5（effort: low 與 medium）、Claude Opus 5.5（effort: low）都 20/20，Haiku 每件成本約 Claude Opus 5.5（effort: low）的 1/4–1/5、延遲相同；`low` 與 `medium` 無差，取 `low`。另 3 題多檔重題（9 檔 import 位置、20 列表格抽取、17 個 SKILL.md 逐字 H1 ＋行號）各 5 次，Haiku 15/15 與 Opus 同分。
- **`dispatch-fallback` 不換**：重題上 Haiku 的成本優勢消失（最重一題均值約 Opus 的 2 倍，單次最高 $1.09）、耗時約 2 倍，而鏈尾還要接瀏覽器取證、web-search，這兩類沒量。維持 Claude Opus 5.5（effort: low）。
- **code-locate 不再經 Grok**：原 Gemini 首跳的 7–10 分鐘延遲逼主線自己用 Opus Grep，那才是最貴的結果；Claude 池用完時主線也動不了，Grok 當第二跳沒有承接意義。這推翻 2026-09-28「code-locate 連 Claude Opus 5.5（effort: low）都不用」的前提（那條比的是 Opus，不是 Haiku）。
- **NEVER**：Herdr pane 開 Haiku（任何版本，helper 拒派）；`general-purpose`／`Plan` 帶 `model: 'haiku'`（gate 武裝 delegate-sub latch）；Workflow `agent()` 寫 Haiku（gate 拒，`agentType: 'haiku-locator'` 除外）；讓 Haiku 寫檔或做判讀、裁決、review。
- **額度**：Haiku 與 Opus、Sonnet 同一 Claude 池，per-model 倍率 UNKNOWN。本節的理由只有延遲與主線 context，**NEVER** 寫「省多少額度」。要把 Haiku 放上新的列，先照同樣方式補 ≥5 reps 量測，題目 MUST 涵蓋該列真實的工作型態。

## delegate-sub（原判 sonnet／haiku 等級的委派工作）

依 [[agent-routing]] § Native delegation model boundary：`DELEGATE_SUB_CHAIN` 自 2026-10-21 起為空（`grok-xai` 退場，原本 Grok 首跳吃外部額度的理由隨訂閱消失），鏈尾即首跳：readonly 交 `dispatch-fallback`（Claude Opus 5.5（effort: low））；**mutation 交 `sonnet-implementer`（Claude Sonnet 5.5（effort: high）），brief 帶 `routing-row: delegate-sub`**——鏈空時可直接派、不必先解 latch；pending 的委派 decision 也由這次 Agent 呼叫解掉——`dispatch-fallback` 沒有 Edit／Write——它也不可用時主線做。以下 Pi 派工與配額降級的敘述只在 Pi 有可派 model 時適用：`--tier-basis delegate-sub` 的 effort 是結論的另一半，`pi-dispatch.ts` 與 `pi-routing-gate.ts` 對 model 與 effort 兩半都比對、矛盾即 exit 1。配額降級沿鏈往下，那些跳仍宣告 `delegate-sub` 並 **MUST** 帶 `--retry-of`。

品質失敗不前進鏈（Pi 有可派 model 時）：delegate 的 Pi 產出品質不合格（exit 2）→ `pi-routing-gate.ts fallback --reason delegate-quality-escalation` 解 latch → 升一次 `sonnet-implementer`（brief 帶 `routing-row: delegate-sub` 與失敗內容）→ 仍不合格主線自己做。

## Devin SWE-2 Max（任意 Pi 列可選）

`swe-2-max`（effort `max`）**不是任何列的固定前綴**。任何 Pi 列，以及 `DEVIN_ELIGIBLE_NATIVE_ROWS` 的六個 native 列（Sonnet 四列、`implementation-decision`、`detailed-planning`），都**可以**選它；原則上**只限相對不急、即便緩慢也不造成堵塞的任務**——唯一例外是 `.claude/skills/coordinator/rules/派工判準.md` Rule 6 的額度例外：Claude 帳號池全數見底時，Devin 適用列的急件可改派 Devin（件上帶 `claude_quota_basis` 寫明池內各帳號讀值，fanout 缺它照拒）。Herdr `--launcher devin` **MUST** 帶 `--non-blocking`（helper 的硬性 admission，缺了 exit 2）——它只是 admission 旗標，不是「不急」的宣告：額度例外的急件同樣照帶，急件身分由 `urgency` 標記與排序承擔。可不可選 Devin 是逐列旗標（`devinEligibleRow()`），**不是**從「Claude-only」推導：`ui-view-implementation`、`design-review`、`ui-detailed-planning`、`screenshot-match-analysis`、`dotclaude-authoring`、`code-review-opus` 不接受 Devin。catalog 只認 `devin models list` 的 exact `swe-2-max`，**NEVER** 猜 suffix 或 alias。

**Sonnet 四列的 Devin 預設（Charles 2026-10-04 取代 2026-09-29 14:1xZ「不預設 Devin」）**：`non-ui-implementation`／`nuxt-core-implementation`／`commit-0c-fix-verify`／`version-upgrade-first-pass` 的**非急件**，內容適合 cloud 的先派 cloud（Charles 2026-10-06：載體偏好 cloud ＞ Devin ＞ 本機 pane）；不適合 cloud 的，主持者的自動加派（`vendor/scripts/coordinator-ready.ts` 的 `sonnetRowCarrier`）在 Devin 在飛數未達目標 15 時補派 Devin `swe-2-max`；Claude 只接 Devin 不適合的件（Claude-only 列、急件、升檔 basis、Devin 放不下或兩台都沒登入）。數字與出處是 `vendor/scripts/lib/coordinator-throughput-policy.ts` 的 `THROUGHPUT_POLICY.carriers`：D-CDB134-3「devin 可以多派到15 session」、D-CDB137-2「只要條件允許我希望你使用更多 swe-2-max 加速開發」、D-CDB138-2「然後你可以派一些 grok 4.7 xhigh 來做一些簡單任務」（Grok 走 `delegate-sub`／pi-dispatch，不在 planner 內派）。census 讀不到在飛數時 planner 不自己挑 Devin（不知道補到幾席就不補）。急件 NEVER 自己挑 Devin（只走上述額度例外：Claude 池全數見底時 `urgentDevinFallback`）。`implementation-decision`／`detailed-planning` 的 Devin 同樣只是可選，預設 Opus。

**現況：Devin 載體停用（Charles 2026-10-15「devin 暫時不續費了 所以調整一下相關派工」）**：`THROUGHPUT_POLICY.carriers.devin.enabled=false`，planner 視同沒有 devin preset——Sonnet 列不補 Devin 席、急件額度例外不生效、plan 條目 `載體：Devin`（carrier_pin）與就緒清單指定的 devin 改走該列原本的 Claude 載體（Sonnet pane／cloud，basis「Devin 停用，改派 Claude」，不 hold）、watch 容量填充行不印「Devin 缺 N 席」；既有 Devin session 的 census／收尾照舊，`launcher-presets.json` 的 devin 組與程式路徑保留。**恢復條件**：Devin 續費後把 `enabled` 翻回 `true`，不需動其他檔。下面兩段描述的是 `enabled=true` 時的行為。

派得出 Devin 的機器是 desk 與 zenbook，兩台都 **MUST** 先 `devin auth status` 判已登入，未登入的那台不派。Devin 省的是額度不是負載：工具指令在派出的那台跑，要卸本機負載就派到負載較低的那台（cloud 是所有 Claude 列的合法載體，用 Opus 還是 Sonnet、effort 多少都照該列，**NEVER** 以 cloud 為由限制 model；Pi 列不改派 cloud）。Devin session 不能 `--continue`，續做一律開新 session 帶 durable brief。載體怎麼跟 cloud、Claude pane 混搭見 [[agent-routing.dispatch-execution]] § Cloud session 載體。

## Claude 帳號池（2026-10-04）

SoT 是 `vendor/scripts/lib/claude-account-registry.ts`——帳號清單只寫在那，下游一律問 registry，NEVER 各自寫死。

- `cc` 是**池入口**：admission 依 `sortPoolCandidates` 挑帳號——各帳號 weekly 讀值齊時按重置配速（快過期且有剩的先、floor 低於下限的沉底），缺一退回 5h／weekly 額度最寬裕者（Pro 帳號也參與一般派工）。一般派工與 routing 表列的 Herdr carrier 一律寫 `cc`，不指定帳號。
- `cc1`／`cc2`／`cc3`／`cc4` **釘選**單一帳號：`cc1` → `~/.claude`、`cc2` → `~/.claude-work`、`cc3` → `~/.claude-3`、`cc4` → `~/.claude-4`（清單 SoT：`vendor/scripts/lib/claude-account-registry.ts`）。只有需要「就這個帳號」時才用（查特定帳號額度、隔離測試、除錯）。**方案（Pro／Max）NEVER 寫在規約裡**：訂閱會升降級，程式讀即時值；要知道某帳號現在是什麼方案就看 watch【額度】段或 `claude-account-preflight.ts` 的輸出，**NEVER** 憑本檔或記憶判斷。
- `ccw` 保留為 `cc2` 的舊名別名：舊 dispatch record、舊 brief、舊 preset 名（`ccw-*` 組已刪，改用 `cc2-*`）與 `account: cc|ccw` 值仍可解析，新寫入一律用 `cc`／`ccN`。

## 工作類別對照

列名是每列開頭 〔`如此標示`〕 的 slug，`--tier-basis table-row` 時逐字填進 `--table-row`。執行鏈的第一跳就是 `--table-row` 要求的 `--model`；後面各跳是配額降級，帶 `--route fallback-chain --retry-of <label>`，由 dispatcher 的 `next_step` 給出。執行鏈寫「空鏈」的列沒有 Pi 跳，鏈尾欄的載體就是首跳。

| 工作類別 | 執行鏈（effort 依上節） | 鏈尾 | 備註 |
| --- | --- | --- | --- |
| 〔`non-ui-implementation`〕非 UI 實作（併入原 `-escalate`） | Claude Sonnet 5.5（effort: high） | 主線 | 修改、測試、修復與交付同一條鏈 |
| 〔`implementation-decision`〕實作中的根因／方案裁決（含 TD／backlog triage） | Claude Opus 5.5（effort: medium） | 主線 | 唯讀分析證據，交付根因、修法限制與驗收條件；TD／backlog 的分類、優先序與處置判定也走本列；in-process 載體 `Plan` subagent 顯式帶 `model: 'opus'`（Sonnet 主線改用 `opus-advisor`）；Devin 可選 |
| 〔`detailed-planning`〕非 UI 詳細實作計畫 | Claude Opus 5.5（effort: medium） | 主線 | 唯讀產出範圍、介面、依賴、task→file 與驗收；載體同上；Devin 可選 |
| 〔`nuxt-core-implementation`〕Nuxt 本體實作 | Claude Sonnet 5.5（effort: high） | 主線 | Nuxt 框架、模組與執行邏輯 |
| 〔`version-upgrade-first-pass`〕version-upgrade 首輪升版 | Claude Sonnet 5.5（effort: high） | 主線 | — |
| 〔`version-upgrade-research`〕version-upgrade 失敗後研究重試 | 空鏈（Grok 4.7 xhigh 2026-10-21 退場） | 主線 | 首跳即主線 |
| 〔`commit-0c-fix-verify`〕commit 0-C fix-verify loop（併入原 `-escalate`） | Claude Sonnet 5.5（effort: high） | 主線 | 同一實作者最多兩輪 check→fix |
| 〔`web-search`〕WebSearch／WebFetch | 空鏈（Grok 4.7 xhigh 2026-10-21 退場） | `dispatch-fallback`（首跳） | 鏈尾 subagent 帶 WebSearch／WebFetch；主線 **NEVER** 直接呼叫內建工具 |
| 〔`mechanical-fanout`〕Mechanical fan-out／收集、掃描、驗證矩陣 | 空鏈（Grok 4.7 xhigh 2026-10-21 退場） | `dispatch-fallback`（首跳） | 觸發與 threshold gate 依 [[agent-routing]] |
| 〔`read-heavy-scan`〕封閉來源固定欄位抽取／read-heavy scan | 空鏈（Grok 4.7 xhigh 2026-10-21 退場） | `dispatch-fallback`（首跳） | 來源矛盾交主線整理為 `implementation-decision`；只收 location ＋可機械複驗欄位，逐字原文不走本列（見硬禁令） |
| 〔`code-locate`〕唯讀定位搜尋（找檔／符號／呼叫點；回 `file:line` ＋ token ＋結論，不回檔案原文；取代 in-process `Explore`） | Claude Haiku 5.5（effort: low）（`haiku-locator` subagent，2026-10-08） | 主線 | 鏈尾是主線自己 Read／Grep，**NEVER** `dispatch-fallback`；readonly；見 § Haiku 5.5 的席位 |
| 〔`notion-ops`〕Notion 讀寫（自由形式 `ntn api`，NEVER Notion MCP；確定性 script 除外，見硬禁令） | 空鏈（Grok 4.7 xhigh 2026-10-21 退場） | `dispatch-fallback`（首跳） | — |
| 〔`screenshot-review-verify`〕Screenshot review 全部四種模式（`[verify:ui]`、archive 前 QA、commit 0-B、ad-hoc） | 空鏈（Grok 4.7 xhigh 2026-10-21 退場） | `dispatch-fallback`（首跳） | browser、截圖與 evidence 收集；取證與 `screenshot-match-analysis` 判定仍分兩步 |
| 〔`copywriting-draft`〕行銷／產品文案草稿與變體 | 空鏈（Grok 4.7 xhigh 2026-10-21 退場） | `dispatch-fallback`（首跳） | 最終文字由主線重寫 |
| 〔`ui-view-implementation`〕UI view 實作（併入原 `ui-implementation`：Nuxt UI／Content） | Claude Opus 5.5（effort: medium） | 無 fallback | Claude Code 原生／Herdr carrier |
| 〔`design-review`〕Design Review／視覺品質判讀 | Claude Opus 5.5（effort: medium） | 無 fallback | 實際讀圖與設計要求 |
| 〔`ui-detailed-planning`〕UI 詳細實作計畫 | Claude Opus 5.5（effort: medium） | 無 fallback | 保留 UI 範圍、互動、狀態與驗收 |
| 〔`screenshot-match-analysis`〕截圖 vs 驗收項目符合性判定 | Claude Opus 5.5（effort: medium） | 無 fallback | 逐張讀實際圖片與完整 item，回 PASS／FAIL／UNCERTAIN |
| 〔`dotclaude-authoring`〕更新 `.claude/` 的檔案（skills、rules、agents、commands、hooks、settings；含投影到 consumer `.claude/` 的 clade 源檔） | Claude Opus 5.5（effort: medium） | 無 fallback | Claude Code 原生／Herdr carrier（`cc` 池入口，見 § Claude 帳號池）；範圍與對 `non-ui-implementation` 的優先序見下方 § `dotclaude-authoring` 的範圍 |
| 〔`code-review-opus`〕Code review／commit 0-A（0-A.1／0-A.2／task reviewer／whole-branch／非 commit review 全部） | Claude Opus 5.5（effort: medium）（Claude Code 主線：in-process `commit-0a-reviewer` subagent；叫不出 Claude subagent 的 runtime：Herdr Claude child） | 無 fallback；**額度耗盡 → gate 保持未完成** | row id 保留 `-opus` 字尾以延續既有 receipt／ledger（原 `code-review`／`code-review-fable` 兩列已刪，歷史 ledger 裡的 `code-review` 是 Astra）。Claude Code 主線跑 `claude-review-safe.sh prepare medium` → AGENT_CALL → FINALIZE；NEVER 走 Pi；NEVER 主線自審補位 |
| 〔`question-review`〕對外提問審查（reply-article 待確認頁發佈前、notion-hub 決策題建票前） | Claude Opus 5.5（effort: xhigh）（in-process `question-reviewer` subagent，frontmatter 釘死；Charles 2026-10-14 為本席開的 effort 例外，其餘 Opus 席除〔`deep-security-audit`〕外仍是 medium） | 無 fallback；不可用時主線依同一份判準自審，回報寫明「未經審查席」 | 唯讀；判準是 `reply-article` skill 根下 `rules/對外提問完整性判準.md`；不經 Pi／Herdr，不進 `NATIVE_TABLE_ROW_POLICIES`；例外理由見 rationale |
| 〔`deep-security-audit`〕上線前／事件驅動的深度安全稽核（claude-security plugin 的 Scan codebase） | claude-security plugin 自帶的 model／effort（研究員／驗證員 `model: inherit`＋xhigh，Sonnet 子 agent low／medium／xhigh，偶發降到 Opus 4.8）；**MUST** 從 Claude Opus 5.5 主線啟動，`inherit` 才落在 Opus 5.5（Charles 2026-10-24 Q3 為本席開的 model／effort 例外，其餘席位不比照） | 無 fallback；主線不是 Opus 5.5 或 plugin 不可用 → 不跑，記為「未做深度稽核」 | 只由 Charles 本人或他授權的 attended 主線發起；**NEVER** 由 coordinator 自動加派、**NEVER** 由 agent 自行點火（push 後的掃描提示要在每台開發機的 `~/.claude/settings.json` env 設 `CLAUDE_SECURITY_SCAN_TIP=off` 關掉；該檔不歸 bootstrap 管，新機器要自己補）；只用 Scan codebase——Scan changes 與 commit 0-S.2 重複，不用；Suggest patches 要直接派 `Agent(claude-security:*)`，routing gate 會攔，不在本席；plugin 產出的 patch **NEVER** 直接套用；**NEVER** 當 commit 0-A 或 0-S 的替代 reviewer；finding 先走 `security-evidence finding`；不經 Pi／Herdr，不進 `NATIVE_TABLE_ROW_POLICIES`；例外理由見 rationale |

**原 GPT-6 Sol 的六列**（2026-09-29）改由 native Claude 席位承接，不再經 Pi：實作四列 Sonnet 5.5（effort: high）、判讀兩列 Claude Opus 5.5（effort: medium）——後兩者錯誤會被下游放大、量小（09-24〜09-29 約 8 次），且官方明言最難的推理選 Opus。

**Sonnet 列品質失敗**：① 主線先診斷，**NEVER** 原樣重派；② brief／規格問題 → 修 brief 再派一次 Sonnet；能力問題（跨層、跨模組推理）→ 派 Claude Opus 5.5（effort: medium）child，`--tier-basis quality-escalation --retry-of <Sonnet 那次的 label>`；小修 → 主線自己做（主線是 Sonnet 時改派同一個 Opus child，§ 主線 residency 的「Sonnet 列品質失敗的小修」缺口）；③ Opus 5.5（effort: medium）再失敗 → 既有 `stall-escalation` 升 high。**NEVER** 借 `stall-escalation` 做 Sonnet → Opus 的跨 model 升級（它量的是 Opus 被迫升 high 的次數）。refusal 不走這條，直接交主線（主線是 Sonnet 時照 § 主線 residency 的 refusal 缺口開 Opus）。

**Sonnet 列的條件式 Opus 顧問配對（Charles 2026-09-29）**：Sonnet 5.5 實作列遇到 ① 方案分歧三條全中——≥2 個合理方案且各有真實 trade-off；用專案內可得證據（rules / spec / 既有 pattern / git history / 上游 changelog）判不出優劣；選錯的成本不是當場可逆的（動到行為契約 / schema / API / 跨 ≥2 檔 / 會散播到 fleet）——或 ② 跨模組設計決定時，**MUST** 先以 `Agent({ subagent_type: 'opus-advisor' })` 取唯讀建議（frontmatter 釘 Claude Opus 5.5（effort: medium）；**NEVER** 用 `Plan`＋`opus`——沒釘 effort 會繼承 Sonnet 的 high，routing gate 擋）：brief 明寫「只回建議與理由，**NEVER** 改任何檔」、thin brief（先預消化，把檔案路徑、規則條目、已排除的方案寫進去）、**等顧問回傳後**才作該決策；拿到建議後照全域 CLAUDE.md § 分歧仲裁 的處置表。其餘日常實作照做不問，**NEVER** 為了「保險」派顧問。載體差異：Herdr Sonnet child 自己派 `opus-advisor`（gate 在 Sonnet 主線擋 `Plan`＋`opus`、放行 `opus-advisor`）；in-process `sonnet-implementer` 叫不出 subagent，改回 `NEEDS_CONTEXT` 附分歧與已排除方案，由主線取顧問意見後再續派。顧問與實作者分歧或多案並列 → Herdr child 走 `--complete blocked --decision`，**NEVER** 自己挑一案硬做。本條是做決定前的諮詢，不是品質失敗升級（那走上一段）。

「無 fallback」的 native 各列在該席位不可用時由主線自己做；commit gate 例外——`code-review-opus`（0-A）與 commit 0-B 用到的 `design-review`／`screenshot-match-analysis`：產出 changeset 的那條線不是它的 reviewer，所以 gate 保持未完成（`commit` skill `review-policy.md`）。

唯讀定位搜尋走 `code-locate` 列（`haiku-locator`）：`Explore` subagent 在任何 model、任何 permission mode（含 plan mode）都被 `pi-routing-gate.ts` 攔下，訊息指向 `Agent({ subagent_type: 'haiku-locator' })` 與 `verify-code-locate.ts`。掃描矩陣與固定欄位抽取照舊走 `mechanical-fanout`／`read-heavy-scan` 列，見 [[agent-routing.dispatch-execution]] § Subagent 回報契約 的「Model 與 effort 顯式指定」。

### `dotclaude-authoring` 的範圍（Charles 2026-09-26）

`.claude/` 是 Claude Code 自己讀的 prompt／規約面，由 Claude 撰寫才與讀者對齊。判定只看**這次派工要寫入的路徑**，不看任務標題：

| 可觀察 predicate | 列 |
| --- | --- |
| 寫入路徑含 `.claude/` 目錄段（任何 repo、任何深度：`.claude/skills/**`、`.claude/rules/**`、`.claude/agents/**`、`.claude/commands/**`、`.claude/hooks/**`、`.claude/settings*.json`） | 本列 |
| clade 源檔，投影後落在 consumer `.claude/`：`rules/core/**`、`rules/modules/**`、`capabilities/**/{skills,agents,commands,hooks,references}/**` | 本列（改源頭與改投影是同一份讀者） |
| `claude-md/**`（落在 consumer `CLAUDE.md`，不在 `.claude/`）、`vendor/scripts/**`、`scripts/**`、`capabilities/**/scripts/**`（不在上一條那五個段之下的 `scripts/`，見下方重疊判定）與其他程式碼 | **不是**本列，照原表查（通常 `non-ui-implementation`） |

**`capabilities/**` 兩條同時命中時**（例如 `capabilities/core/skills/<name>/scripts/*.ts`）：看寫入路徑裡**最靠近 `capabilities/` 的**那個 `skills`／`agents`／`commands`／`hooks`／`references`／`scripts` 目錄段——前五者之一 → 本列（skill 底下的 `scripts/` 投影後落在 consumer `.claude/skills/<name>/scripts/`，「寫入路徑含 `.claude/` 目錄段」那列也命中）；是 `scripts` → 不是本列（例如 `capabilities/core/scripts/**`）。只看路徑字串，**NEVER** 依檔案副檔名或任務標題改判。

**與 `non-ui-implementation` 的優先序**：同一件同時寫 `.claude/`（含上表源檔）與其他程式碼時——

1. 兩側拆得開（各自能獨立通過驗收）→ **拆成兩次派工**，各自依寫入路徑查表。
2. 拆不開（同一個行為契約的兩端，例如改 hook 腳本連帶改 `settings.json` 註冊與它的測試）→ **本列優先**，整件由 Claude Opus 5.5（effort: medium）做。理由：Opus 寫程式碼沒有檔位缺口，而 `.claude/` 規約面影響整個 fleet，本列要的是 Opus 的判讀（原本要擋的是 GPT 寫給 Claude 讀的規約）。

consumer 端的 `.claude/rules/local/**` 同樣命中「寫入路徑含 `.claude/` 目錄段」那列；本列只決定載體，**不**改變「clade 源檔先改 clade 再散播」的路由（`clade-source-routing`）。

已退場的列 id（`non-ui-implementation-escalate`、`commit-0c-fix-verify-escalate`、`ui-implementation`、`code-review`、`code-review-fable`）只留在歷史 ledger；新派工帶它們 dispatcher exit 1 並指出吸收它的列（`RETIRED_TABLE_ROWS`）。

## Pi 派工的 workspace capability

> **每一個**會修改 working tree、lockfile、Git index 或建立 commit 的 Pi caller／brief 都屬 `mutation`：concrete table row 由 `pi-routing-policy.ts` 分類，manual caller **MUST** 帶 `--workspace-access mutation`；quota retry **MUST** 沿用 dispatcher 的 `next_step`／`--retry-of`，由 ledger 繼承同一 capability。只讀 inspection／review 才是 `readonly`。

### Routing 硬禁令（逐列）

查到某一列時 MUST 回頭讀本節對應列，**NEVER** 只讀對照表就派。

| 列 | 硬禁令 |
| --- | --- |
| 任一列 | **NEVER** 派 § 禁用 表內的 model；**NEVER** 用非 `TIER_EFFORT` 的 effort。 |
| 〔`web-search`〕 | 查不到就回「查不到」，**NEVER** 拿二手彙整頁充數。主線 **NEVER** 直接呼叫內建 WebSearch／WebFetch——鏈尾是 `dispatch-fallback` subagent。 |
| 〔`screenshot-review-verify`〕 | 由主線直接派 `dispatch-fallback` subagent，**NEVER** 以其他 subagent 中介轉派。收集與判定 **NEVER** 併成同一次 dispatch。 |
| 〔`screenshot-match-analysis`〕 | 逐張讀實際截圖與 item 要求；**NEVER** 把取證 dispatch 的自述當判定。 |
| 〔`mechanical-fanout`〕 | **NEVER** 以「我自己順手跑掉比較快」略過本列（成因見 rationale）。 |
| 〔`copywriting-draft`〕 | **主線 MUST 收斂重寫每一條採用的文案，NEVER 原樣貼進交付物**——Pi 回的是素材不是成稿。本列只涵蓋行銷／產品對外文案，**NEVER** 外推到規約措辭／commit message／技術文件／PR 描述／對外報告。 |
| 〔`notion-ops`〕 | **NEVER** 主線第一手自己跑 ntn。**本列不涵蓋確定性 script**：`vendor/scripts/notion-sync.ts`、`vendor/scripts/lib/notion-hub.ts resolve`、`scripts/audit-notion-hub-schema.ts` 主線直接跑。Notion MCP 不是本列的合法 transport，**NEVER** 使用。 |
| 〔`read-heavy-scan`〕 | **NEVER** 拿「反正我讀一下就知道了」略過 gate，也 NEVER 把固定輸出 schema 當成不需裁決的證據。**NEVER 在本列的 brief 要求 verbatim `raw`／逐字引用**：本列每筆只收 location（`file` ＋ `line` 或 JSON pointer）＋可機械複驗欄位（該行命中的字面 token、計數）；要逐字原文的抽取不派本列，由主線拿 location 以確定性指令（`sed -n '<line>p' <file>`、`grep -nF '<token>' <files>`）自己取回。回傳裡只要出現 `raw`／引用字串，**每一筆** MUST 以 `grep -F` 對它所標的檔複驗，任一筆不中就**整份作廢**重取，**NEVER** 挑命中的那幾筆用（`pi-dispatch.ts` 對本列 JSON 回傳機械複驗的範圍：`raw`／`raw_value` 兩種 key，對 `file`／`path`／`source` 或 `location` 的 `path:line` 解出的檔，空字串也算不中，不中即 exit 2 帶 `verbatim_raw_mismatch`；其他 key 名的引用字串、非 JSON 回傳與鏈尾 `dispatch-fallback` 的輸出不在範圍內，由消費端自己驗）——捏造物與真結果同形（exit 0、schema 對、行數對），不複驗就沒有偵測面（TD-953：同一份 brief 5 reps 中 1 rep 有 43/172 筆 heading 為檔內不存在的捏造）。 |
| 〔`code-locate`〕 | 回傳只收 `file:line` ＋結論，**NEVER** 在 brief 要求檔案原文或逐字引用。每一筆 `file:line` MUST 以 `verify-code-locate.ts` 機械複驗（該行含回報的 token），**任一筆不中就整份作廢**重取，**NEVER** 挑命中的那幾筆用——精神同 `read-heavy-scan`。`haiku-locator` 不可用時由主線自己 Read／Grep，**NEVER** 派 `dispatch-fallback` 或 `Explore`。 |
| 〔`non-ui-implementation`〕〔`nuxt-core-implementation`〕〔`version-upgrade-first-pass`〕〔`commit-0c-fix-verify`〕 | **NEVER** 經 Pi；effort 恆 `high`（Herdr table-row 准入逐字比對；cloud 由 `cloud-dispatch.ts` 逐件帶 `--effort high`）；in-process 只准 `sonnet-implementer`，brief MUST 有 `routing-row:` 行；品質失敗照上方 § Sonnet 列品質失敗，refusal 直接交主線；方案分歧／跨模組設計決定先照上方 § Sonnet 列的條件式 Opus 顧問配對。 |
| 〔`implementation-decision`〕〔`detailed-planning`〕 | **NEVER** 經 Pi（`--tier-basis adjudication` 已退場）；**NEVER** 改派 Sonnet 以「省額度」——判讀錯誤會被下游放大。 |
| 〔`dotclaude-authoring`〕 | **NEVER** 經 Pi 派工（`pi-dispatch.ts` 以 Claude-only 拒跑）；**NEVER** 以「只是改一行 settings／改幾個字」把 `.claude/` 寫入塞進 `non-ui-implementation` 的派工——拆不開就整件走本列。 |
| 〔`code-review-opus`〕 | **NEVER** 經 Pi 派工；effort 恆 `medium`；Opus 額度耗盡 → gate 保持未完成，**NEVER** 改派其他模型、**NEVER** 主線自審補位；receipt MUST 記 requested／observed model 與 `model_verification`，`requested_model` 不是 Opus 5.5 的 verdict 不得當 gate 證據。 |

> **每一次** pi dispatch **MUST 帶 `--route` 與 `--tier-basis`**（缺就 exit 1）：前者記走哪條政策（本表某列 → `routing-table`；§ delegate-sub → `claude-delegate-sub`；配額降級 → `fallback-chain`；皆非才**顯式** `manual`），後者記該政策對 model 的**結論**；dispatcher 交叉檢查兩者與 `--model`、`--effort`，矛盾即 exit 1。**NEVER** 不確定就填 `manual` ／ `table-row`——與「判定沒發生」不可區分。重試帶 `--retry-of <label>`，**NEVER** 用 `<label>2`。
>
> **`--tier-basis table-row` 時 MUST 再帶 `--table-row <列名>`**（缺就 exit 1）。**NEVER** 在派工當下偏離列上的 model —— 認為某列該換檔位就先改本表（與 `pi-routing-policy.ts`）再派。
>
> **Routing Table 類別的檔位選擇中，NEVER** 拿「輸出會被下游機械消費」當降檔理由：下游若只驗 JSON schema 而不驗語意，降檔引入的錯誤會被自動放大。
>
> **跑分、配額權重、擴權取證這三類「拿數字當理由」的陷阱，全文在 [[agent-routing.routing-table-rationale]]**。要拿任何數字支持一次降檔 / 轉列之前 MUST 先讀它，**NEVER** 憑印象引用比例。
