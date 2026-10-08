# owner 載入與 explicit 入口代打

觸發點：SKILL.md 第 2 步（每一次載入下游 owner 或交棒之前）。文中「第 N 節」指 SKILL.md 的第 N 步與它讀取的判準檔：第 0 節 `rules/worktree隔離與work-id.md`、第 1 節 `rules/定位既有工作與鑄id.md`、第 2 節 `rules/owner載入與代打.md`、第 3 節 `rules/前提修復與gate失敗.md`、第 4 節 `rules/依產物推進.md`、第 5 節 `rules/驗收交付與回報.md`；「上表」「判定表」未另指明時指 `rules/需求分流與免package.md` Rule 2。

# Rule 1 - 先讀上游覆寫檔，再照位置表載入真正可用的 owner

- Level: `MUST`

MUST 先讀 `rules/上游覆寫-lifecycle落點與doctor.md`，才載入下游 owner——**每一次**、下表每一列都一樣，含公開入口 specify、clarify、system-analysis、implement 與 bundle 內的內部流程。上游 owner 的原文是 pin 的上游版本，clade 的 lifecycle 落點（L）與 canonical doctor（D）調整只寫在那份檔：命中它寫明的判準就照覆寫列執行，沒命中照 owner 原文。**NEVER** 只讀 owner 的 `SKILL.md` 就開始寫 artifact——上游原文會建 `NNN-*` package、`truth-delta.md`、覆寫 lifecycle `plan.md`，也不跑 doctor。

公開 skill 與內部流程是兩種合法交棒方式，先按下表定位，不能用頂層同名目錄缺席判內部流程不可用。

| Owner | 實際載入位置（相對本 skill） |
| --- | --- |
| constitution | `rules/.constitution/SKILL.md` |
| spec-by-example | `rules/.workflow/spec-by-example/SKILL.md` |
| technical-research | `rules/.workflow/technical-research/SKILL.md` |
| ui-plan | `rules/.workflow/ui-plan/SKILL.md` |
| api-plan、data-plan | `rules/.workflow/<owner>/SKILL.md` |
| dsl-refine、gherkin-and-dsl | `rules/.workflow/<owner>/SKILL.md` |
| tasks、bdd、truth-delta | `rules/.workflow/<owner>/SKILL.md` |
| clarify-over-specs | 優先當前 runtime 已安裝公開入口；未提供時用 `rules/.workflow/clarify-over-specs/SKILL.md` |
| specformula-config、specformula-api-spec、specformula-entity-spec、specformula-feature | `rules/.workflow/<owner>/SKILL.md`；只由本檔 Rule 3 的宿主 owner 載入，不單獨成步 |
| specify、clarify、system-analysis、implement | 當前 runtime 的公開入口與必要 resources；Claude 端這四支模型呼叫不了，照本檔 Rule 2 |

本 skill 根：Claude `.claude/skills/work-route/`、Codex `.agents/skills/work-route/`。內部流程由 `clade-workflow-bundles` 隨本 skill 投影到 `.` 開頭的目錄（避免被 runtime 列成公開 skill），多數搜尋工具預設不掃，所以一律照上表明確路徑讀取，**NEVER** 用搜尋結果為空判定不存在。只讀本步入口及它明列的必讀資源。

## Good Example

- 這個例子是好的，因為載入 owner 前先讀覆寫檔，再照表上明確路徑讀內部流程。

```text
輪到 tasks → 讀 rules/上游覆寫-lifecycle落點與doctor.md → 讀 rules/.workflow/tasks/SKILL.md → 命中 L 覆寫列照覆寫執行
```

## Bad Example

- 這個例子是壞的，因為只讀 owner 的 SKILL.md 就寫 artifact，或用搜尋結果為空判內部流程不存在。

```text
Glob 找不到 tasks/SKILL.md（dot 目錄預設不掃）→ 判定 tasks 不可用
```

# Rule 2 - explicit 入口（specify／clarify／system-analysis／implement）由本 agent 代打

- Level: `MUST`

specify、clarify、system-analysis、implement 在 Claude 端帶 `disable-model-invocation`：`Skill` 工具會拒絕，也 **NEVER** 讀它們的檔照跑。第 4 節依 package 產物狀態輪到其中一支時，本 agent 就是派工者：派一個本機 session，brief 第一行寫 `/<skill> <一句範圍>`，由 dispatcher 當成使用者指令送進去；收到它的結果後查驗產出，回第 4 節重新判定下一步。**NEVER** 停下來請使用者親打。

| 可觀察 predicate | 處理 |
| --- | --- |
| 第 4 節判定下一步是這四支之一，package 已鑄出、本步前提已過，本 session 不是被派出的（`CLADE_DISPATCH_ID` 為空） | 代打派出，brief 照下方「brief 必寫」 |
| 同上，但本 session 是被派出的（`CLADE_DISPATCH_ID` 非空） | dispatcher 拒絕巢狀派工（`nested_dispatch_refused`）。以 `--complete blocked --decision` 交回派工者，寫明要代打哪一支、package 路徑與範圍；**NEVER** 自己再派 |
| 輪到 clarify，先前代打 specify 的 pane 還在 | `--continue <pane>` 送第一行 `/clarify <範圍>` |
| 輪到 clarify，那個 pane 已收回，或是跨 session 續跑 | 新派一個本機 session，第一行 `/clarify <範圍>` |
| 還沒過第 0–1 節（沒有 work id、沒有 package），或第 4 節判定的下一步不是這四支 | **NEVER** 代打；先完成本入口該步 |
| dispatcher 不可用（不在 Herdr、transport 失敗） | 保留 brief 並回報 blocker；**NEVER** 改成自己讀檔照跑 |

**brief 必寫**（被代打的 session 不經本入口第 2 節，這些它自己走不到）：

- 第一行 `/<skill> <一句範圍>`，400 字以內；其他位置 **NEVER** 再以斜線形式點名這四支（dispatcher 會拒收）
- package 路徑、範圍停在這一支、需求缺口先從 repo 查證後作答，查不到的標 `NEEDS CLARIFICATION` 回報
- `rules/上游覆寫-lifecycle落點與doctor.md` 的路徑（L 落點與 doctor 覆寫）
- 該 owner 的 clade overlay：implement 帶 `implement/specformula.md`（與 implement 的 `SKILL.md` 同目錄），並帶 `owner-routing.md` 的路徑（task 外派的列與首跳）

**派法**：以本 repo 的 session dispatcher（`herdr-session-handoff.ts`）開**本機** session，`--cwd` 是該 work 的 worktree，帶 `--coordinate`（派工者等它回報；不帶時它收到的指示是「派工者已收工」，不會回報）。argv（本 repo 沒有 `coordinator` skill 時照此拼，不必另找規約）：

```text
node <vendor>/scripts/herdr-session-handoff.ts --cwd <該 work 的 worktree> --coordinate \
  --model claude-opus-5-5 --effort medium \
  --route routing-table --tier-basis table-row --table-row <列> --prompt-file <brief>
```

`<列>` 照 `owner-routing.md`：specify／clarify 是 `mainline-contract`，system-analysis 是 `detailed-planning`，implement 入口是 `mainline-analysis`；dispatcher 只在 brief 第一行是代打指令、且列與該 skill 相符時收主線列，**NEVER** 改填 `--route manual`。第一行超過 400 字、或要派到 peer 機器，dispatcher 都會拒收（第一行只留一句範圍、細節放第二行起；peer 機器改在該機本地派）。clade 的 `coordinator` skill `rules/派工判準.md` Rule 11 有同一份 argv 與範例。

代打只換「誰敲指令」：高影響需求缺口與 Gherkin 的 PM 確認仍照第 4 節停下來問。

## Good Example

- 這個例子是好的，因為未被派出的 session 輪到 specify 時派本機 session 代打並等回報。

```text
第 4 步判定下一步是 specify、CLADE_DISPATCH_ID 為空 → herdr-session-handoff.ts --cwd <worktree> --coordinate … --table-row <列> --prompt-file <brief>（第一行 /specify <範圍>）
```

## Bad Example

- 這個例子是壞的，因為停下來請使用者親打，或自己讀那四支的檔照跑。

```text
Skill 工具拒絕 specify → Read specify/SKILL.md 照著做
```

# Rule 3 - clade overlay 與 SpecFormula 契約只從本表走得到，載入宿主時一併讀

- Level: `MUST`

**clade overlay 只從本表走得到。** 三個 owner 各有一份 clade-owned 的 `specformula.md`，上游 `SKILL.md` 不會提到：bundle 內的 `rules/.workflow/bdd/specformula.md`、`rules/.workflow/technical-research/specformula.md`，以及公開入口 implement 目錄的 `implement/specformula.md`（與 implement 的 `SKILL.md` 同目錄）。載入這三個 owner 時 MUST 一併讀它，依該檔的適用條件套用（bdd 那份在後端 BDD techstack 是 SpecFormula 時不手寫 step definition；technical-research 那份給三題必問的 fleet 預設；implement 那份把 Phase 3 的三個 marker 改落在規格檔）。**NEVER** 因上游入口沒列就略過。

#### SpecFormula 契約載入點

`specs/truth/techstack.md` 的後端 BDD techstack 是 SpecFormula 時，下列四支上游契約由表中的宿主 owner 在該步載入，與宿主契約一起執行；techstack 未採 SpecFormula 就一支都不載。它們規定 SpecFormula 的檔案形狀，不取代宿主的 truth 所有權、PM gate 或驗收。**NEVER** 用「宿主 `SKILL.md` 沒提到」略過；也 **NEVER** 在宿主以外的步驟自行改寫它們管的檔。

| 契約 | 宿主 owner 與時機 | 本步必須做到 |
| --- | --- | --- |
| `specformula-config`（含 `nuxt.md`、`java.md`、`custom-instruction.md`） | technical-research 選定 SpecFormula 時；implement 的 Setup task 安裝與接線時；implement `[BDD-ALIGN]` 或 bdd `red` 要新增 `isa.yml` 指令時 | 選定時確認 `isa.yml` 表達得了本專案的資料源與 `db_type`，限制寫進 techstack。Nuxt 專案的安裝照 clade-owned 的 `rules/.workflow/specformula-config/nuxt.md` 與 `~/offline/clade/vendor/snippets/specformula/` cookbook。新句型先加 `instructions[]` regex，框架做不到的才用 `custom`（`custom-instruction.md`） |
| `specformula-api-spec` | api-plan Phase 3 寫 truth OpenAPI 時 | `isa.yml` 的 `config.api.resource_path` 讀的就是 api-plan 維護的 `specs/truth/contracts/**`，不另存一份 OpenAPI。每個 operation 的 `summary` 全域唯一，用業務語言的「動詞＋名詞」。`isa.yml` 指向另一份 OpenAPI 時不手動同步兩份，交 tasks 排一條把 `isa.yml` 改指 truth 的 task |
| `specformula-entity-spec` | data-plan 本輪有 table／field 語意變更時，同一輪 | 更新 `isa.yml` 各 `config.data.source[].resource_path` 下的 `entity_to_table_mapping.yml`（業務語言實體名）與 DDL（語法依該 source 的 `db_type`），與 DBML 同一語意；落在 `specs/truth/data/**` 內時一併列進本輪 delta。只改 API 的工作不捏造 entity |
| `specformula-feature`（含各指令檔） | implement `[BDD-ALIGN]` 寫 `dsl.yml` 的 `isa_steps` 時；bdd `red` 補 `.feature` 的 `Example` 時 | 先讀專案 `isa.yml` 的 `instructions[].format`，指令句與符號（`>`、`<`、`$`、`&`）照該契約與各指令檔；`dsl.yml` 的轉換規則仍照 `implement/specformula.md` |

採 SpecFormula 時，`rules/依產物推進.md` 的表 technical-research、api-plan、data-plan、implement、bdd 這幾步另依本檔本條的 SpecFormula 契約表載入對應契約；那張表沒列到的步驟不載。

## Good Example

- 這個例子是好的，因為載入 bdd 時一併讀它的 clade-owned specformula.md，並依 techstack 決定是否載入 SpecFormula 契約。

```text
techstack 後端 BDD 是 SpecFormula、輪到 bdd red → 讀 rules/.workflow/bdd/SKILL.md＋rules/.workflow/bdd/specformula.md＋specformula-feature 契約
```

## Bad Example

- 這個例子是壞的，因為因上游入口沒列就略過 overlay，或在宿主以外的步驟自行改寫契約管的檔。

```text
「bdd 的 SKILL.md 沒提到 specformula.md」→ 手寫 step definition
```

# Rule 4 - 下游契約提到的流程名與 script 前綴回位置表解析

- Level: `MUST`

下游契約提到 `/tasks`、`/bdd`、`/truth-delta` 等流程時回本表解析，由 orchestrator 載入契約執行，不把缺少 slash UI 當成能力缺失。上游契約的 `.agents/skills/<owner>/scripts/...` 前綴換成當前 runtime 的 `work-route/rules/.workflow/<owner>/`，保留腳本與參數。尤其 gherkin-and-dsl Phase 6 必須實際執行 `uv run <work-route-root>/rules/.workflow/gherkin-and-dsl/scripts/audit_feature_dsl_topology.py --root <features-root>`；其中 `<work-route-root>` 是上表所列當前 runtime 的 skill 根，`<features-root>` 是 **truth 的介面根**（含 `dsl.md` 的那一層，例如 `specs/truth/features/cli`）。plan package 的 `features/acceptance/` 沒有 `dsl.md`，拿它當 root 每一個 step 都會報找不到 DSL row——plan 端 acceptance 的對應檢查是 `flow plan readiness <work-id>`（dry-run 無 undefined／ambiguous step）。保留稽核輸出，失敗交回該 owner，不因路徑搬移而略過。

## Good Example

- 這個例子是好的，因為把上游前綴換成當前 runtime 的路徑並實際執行稽核。

```text
uv run .claude/skills/work-route/rules/.workflow/gherkin-and-dsl/scripts/audit_feature_dsl_topology.py --root specs/truth/features/cli
```

## Bad Example

- 這個例子是壞的，因為拿 plan package 的 features/acceptance/ 當 root，或因路徑搬移略過稽核。

```text
--root specs/plans/W-…/features/acceptance → 每一個 step 都報找不到 DSL row → 當成 gate 壞了跳過
```

# Rule 5 - 每一次交棒前讀 owner-routing.md 並留下交棒紀錄

- Level: `MUST`

**每一次**交棒給 owner（含 owner 內要外派的工作）之前，MUST 讀 skill 根的 `owner-routing.md`，照該 owner 那一列決定由誰執行（主線或 routing table 的哪一列、首跳 model／effort）。表上沒有的 model 或 effort 不自行挑；列的硬禁令與派不派判準照 routing table。

每次交棒都記錄 runtime、owner、執行者（`owner-routing.md` 的列與首跳）、實際載入路徑、必要 artifact 與同步證據。用既有 projector 的唯讀規劃／check 核對目前 checkout；檔案存在、dry-run exit 0、另一 runtime 的成功都不單獨證明已同步。

## Good Example

- 這個例子是好的，因為照 owner-routing.md 的列決定執行者並記錄同步證據。

```text
交棒 implement 外派的 task → 讀 owner-routing.md 該列 → 照首跳 model／effort 派 → 記錄 runtime、owner、執行者、載入路徑、artifact、同步證據
```

## Bad Example

- 這個例子是壞的，因為自行挑表上沒有的 model，或以另一個 runtime 的成功證明本 checkout 已同步。

```text
「Codex 那邊跑過了」→ 不核對目前 checkout 的投影就交棒
```
