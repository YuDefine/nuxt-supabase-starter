# work-route owner 執行者紀錄

每一步交棒前查本表：這個 owner（或 owner 內的這類工作）對到 [[agent-routing.routing-table]] 的哪一列、首跳是哪個 model 與 effort。本表只做「owner → 列」的對照；model、effort、鏈、硬禁令的 SoT 仍是 routing table。查到 routing table 的列之後照它的硬禁令與 [[agent-routing]] § 派不派 執行，不以本表代替。

## 怎麼讀

- **列**：routing table 的列 slug，或主線列。`mainline-contract`（契約／定稿）與 `mainline-analysis`（定位與裁決）不在 routing table 表內，是 `pi-routing-policy.ts` 記帳用的主線列：不外派，依據是 [[agent-routing]] § 派不派 的「規約／契約／對外定稿」與 routing table § 判不進任一列時。
- **首跳**：該列的第一個載體與 effort，一律明寫。配額降級的後續各跳由 dispatcher 的 `next_step` 給出，不抄在這裡。
- **effort 照 routing table**：首跳欄的 model 與 effort 就是 routing table 對該列的現值，Claude Opus 5.5 目前一律 `medium`。Charles 2026-09-25 的原則是 Opus 5.5 ≤ `medium`、高於 `medium` 只在該 owner 的 `SKILL.md` 明寫時開；要把某一列改成 `low` 或更高，先改 routing table 與 `vendor/scripts/pi-routing-policy.ts`（更高檔另要放寬 herdr helper 的 Opus 天花板），再改本表。**NEVER** 只改本表的檔位，也 **NEVER** 在派工當下自行抬檔或降檔。
- **主線列**（`mainline-*`）：一律由主線自己做，不外派。首跳欄寫的是 Claude Code 主線的 model 與 effort（routing table 的主線定義）；其他 runtime 的主線同樣自己做這些步驟。
- **Claude Opus 5.5・medium 的列**：Claude Code 主線自己就是合格 executor，照 § 派不派 預設自己做；review 類 gate（`code-review-opus`）例外，產出 changeset 的那條線不審自己，一律交 fresh-context reviewer。非 Claude 主線依 adapter 交 Claude carrier。
- **GPT-6 Sol・xhigh 與 Gemini 3.8 Flash・high 的列**：Claude 主線不是合格 executor，走 Pi（`--route routing-table --tier-basis table-row --table-row <列>`）；Codex 主線用 native subagent。外派實作綁 lifecycle package 時先過 `flow plan readiness`。
- **唯讀列**（`detailed-planning`、`implementation-decision`、`web-search`、`read-heavy-scan`）：executor 只回內容，artifact 由主線寫入。
- 本表沒列到的工作，照 routing table § 判不進任一列時。

`wt`、`clade-onboard`、`project-bootstrap`、`clade-publish` 是 session gate 或不可逆動作，一律主線（Claude Opus 5.5・medium），不外派。

## 對照

| owner／工作 | 列 | 首跳 | 附註 |
| --- | --- | --- | --- |
| work-route 本身：定位工作、前提修復、呈現 PM 確認 | `mainline-analysis` | Claude Opus 5.5・medium | |
| `constitution` | `mainline-contract` | Claude Opus 5.5・medium | |
| `specify` | `mainline-contract` | Claude Opus 5.5・medium | 與使用者確認需求 |
| `clarify`、`clarify-over-specs` | `mainline-contract` | Claude Opus 5.5・medium | 與使用者問答 |
| `spec-by-example` | `mainline-contract` | Claude Opus 5.5・medium | |
| `technical-research`：決策與 techstack 定稿（含選定 SpecFormula 時的 `specformula-config`） | `mainline-contract` | Claude Opus 5.5・medium | |
| `technical-research`：外部網路查證 | `web-search` | Gemini 3.8 Flash・high | 主線不直接呼叫內建 WebSearch／WebFetch |
| `technical-research`：大量讀既有 codebase 抽固定欄位 | `read-heavy-scan` | Gemini 3.8 Flash・high | |
| UI 需求確認用的設計雛形（design／impeccable） | `ui-view-implementation` | Claude Opus 5.5・medium | UI 檔位實測中；改檔位先改 routing table |
| 設計品質判讀 | `design-review` | Claude Opus 5.5・medium | UI 檔位實測中；改檔位先改 routing table |
| UI 截圖取證 | `screenshot-review-verify` | Gemini 3.8 Flash・high | 主線直接呼叫 Pi；取證與判定分兩次 |
| 截圖與驗收項目的符合性判定 | `screenshot-match-analysis` | Claude Opus 5.5・medium | UI 檔位實測中；改檔位先改 routing table |
| `system-analysis` | `detailed-planning` | GPT-6 Sol・xhigh | 主線寫 `system-analysis.md` |
| `api-plan`（含 `specformula-api-spec`） | `mainline-contract` | Claude Opus 5.5・medium | truth `contracts/**` 定稿 |
| `data-plan`（含 `specformula-entity-spec`） | `mainline-contract` | Claude Opus 5.5・medium | truth `data/**` 與 entity spec 定稿 |
| `truth-delta` | `mainline-contract` | Claude Opus 5.5・medium | |
| `ui-plan` | `ui-detailed-planning` | Claude Opus 5.5・medium | UI 檔位實測中；改檔位先改 routing table |
| `dsl-refine`、`gherkin-and-dsl` | `mainline-contract` | Claude Opus 5.5・medium | topology audit 由主線直接跑 |
| `tasks` | `detailed-planning` | GPT-6 Sol・xhigh | 主線寫 `tasks.md` |
| `implement`：選 task、派工與收回、實跑驗證、回寫 `[X]`、`[BDD-GREEN]`／`[BDD-REFACTOR]` 委派 `bdd` | `mainline-analysis` | Claude Opus 5.5・medium | 被派出的 task 照下列各列 |
| `implement`：非 UI 實作——Setup／Foundational、`[CODE-REMOVE]`、`[REGRESSION]`、Phase 3 `[BDD-ALIGN]`／`[BDD-REMOVE]`／`[BDD-RED]`（含 `specformula-feature`）、SpecFormula 安裝接線（`specformula-config`） | `non-ui-implementation` | GPT-6 Sol・xhigh | Nuxt 框架或模組本體改填 `nuxt-core-implementation`（同檔位）；BDD 標記的語意要變就回交 `dsl-refine` |
| `implement`：UI view | `ui-view-implementation` | Claude Opus 5.5・medium | UI 檔位實測中；改檔位先改 routing table |
| `implement`：Phase 3 review | `code-review-opus` | Claude Opus 5.5・medium | 不走 Pi、沒有 fallback；額度耗盡時 gate 保持未完成 |
| `bdd` 的 `red`／`green`／`refactor`（含 `specformula-feature`、`specformula-config`） | `non-ui-implementation` | GPT-6 Sol・xhigh | 語意要變就回交 `dsl-refine` |
| 實作中的根因或方案裁決 | `implementation-decision` | GPT-6 Sol・xhigh | |
| commit 0-A | `code-review-opus` | Claude Opus 5.5・medium | 照 `claude-review-safe.sh` 的 AGENT_CALL／FINALIZE |
| commit 0-C fix-verify | `commit-0c-fix-verify` | GPT-6 Sol・xhigh | |
