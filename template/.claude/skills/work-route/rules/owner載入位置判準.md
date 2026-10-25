# owner 載入位置判準

觸發點：`SKILL.md` Phase 4 step 2（每一次載入下游 owner 或交棒之前）。

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
| specformula-config、specformula-api-spec、specformula-entity-spec、specformula-feature | `rules/.workflow/<owner>/SKILL.md`；只由 `rules/SpecFormula契約載入判準.md` 的宿主 owner 載入，不單獨成步 |
| specify、clarify、system-analysis、implement | 當前 runtime 的公開入口與必要 resources；Claude 端這四支模型呼叫不了，照本檔 Rule 2 |

本 skill 根：Claude `.claude/skills/work-route/`、Pi `.agents/skills/work-route/`。內部流程由 `clade-workflow-bundles` 隨本 skill 投影到 `.` 開頭的目錄（避免被 runtime 列成公開 skill），多數搜尋工具預設不掃，所以一律照上表明確路徑讀取，**NEVER** 用搜尋結果為空判定不存在。只讀本步入口及它明列的必讀資源。

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

specify、clarify、system-analysis、implement 在 Claude 端帶 `disable-model-invocation`：`Skill` 工具會拒絕，也 **NEVER** 讀它們的檔照跑。`SKILL.md` Phase 6 依 package 產物狀態輪到其中一支時，本 agent 就是派工者：派一個本機 session，brief 第一行寫 `/<skill> <一句範圍>`，由 dispatcher 當成使用者指令送進去；收到它的結果後查驗產出，回 Phase 6 重新判定下一步。**NEVER** 停下來請使用者親打。

| 可觀察 predicate | 處理 |
| --- | --- |
| Phase 6 判定下一步是這四支之一，package 已鑄出、本步前提已過，本 session 不是被派出的（`CLADE_DISPATCH_ID` 為空） | 代打派出，brief 照下方「brief 必寫」 |
| 同上，但本 session 是被派出的（`CLADE_DISPATCH_ID` 非空） | dispatcher 拒絕巢狀派工（`nested_dispatch_refused`）。以 `--complete blocked --decision` 交回派工者，寫明要代打哪一支、package 路徑與範圍；**NEVER** 自己再派 |
| 輪到 clarify，先前代打 specify 的 pane 還在 | `--continue <pane>` 送第一行 `/clarify <範圍>` |
| 輪到 clarify，那個 pane 已收回，或是跨 session 續跑 | 新派一個本機 session，第一行 `/clarify <範圍>` |
| 還沒過 Phase 2–3（沒有 work id、沒有 package），或 Phase 6 判定的下一步不是這四支 | **NEVER** 代打；先完成本入口該步 |
| dispatcher 不可用（不在 Herdr、transport 失敗） | 保留 brief 並回報 blocker；**NEVER** 改成自己讀檔照跑 |

**brief 必寫**（被代打的 session 不經本入口 Phase 4，這些它自己走不到）：

- 第一行 `/<skill> <一句範圍>`，400 字以內；其他位置 **NEVER** 再以斜線形式點名這四支（dispatcher 會拒收）
- package 路徑、範圍停在這一支、需求缺口先從 repo 查證後作答，查不到的標 `NEEDS CLARIFICATION` 回報
- `rules/上游覆寫-lifecycle落點與doctor.md` 的路徑（L 落點與 doctor 覆寫）
- 該 owner 的 clade overlay：implement 帶 `implement/specformula.md`（與 implement 的 `SKILL.md` 同目錄），並帶 `rules/owner-routing.md` 的路徑（task 外派的列與首跳）

**派法**：以本 repo 的 session dispatcher（`herdr-session-handoff.ts`）開**本機** session，`--cwd` 是該 work 的 worktree，帶 `--coordinate`（派工者等它回報；不帶時它收到的指示是「派工者已收工」，不會回報）。argv（本 repo 沒有 `coordinator` skill 時照此拼，不必另找規約）：

```text
node <vendor>/scripts/herdr-session-handoff.ts --cwd <該 work 的 worktree> --coordinate \
  --model claude-opus-5-5 --effort medium \
  --route routing-table --tier-basis table-row --table-row <列> --prompt-file <brief>
```

`<列>` 照 `rules/owner-routing.md`：specify／clarify 是 `mainline-contract`，system-analysis 是 `detailed-planning`，implement 入口是 `mainline-analysis`；dispatcher 只在 brief 第一行是代打指令、且列與該 skill 相符時收主線列，**NEVER** 改填 `--route manual`。第一行超過 400 字，dispatcher 會拒收（第一行只留一句範圍、細節放第二行起）。`--machine` 派到 peer 與 `--continue` 到 peer 都可以代打：全文落在 peer 的 cwd、判斷看 peer 的 skill 投影（ssh 讀不到投影回 `transport_error`，重試連線即可）。clade 的 `coordinator` skill `rules/派工判準.md` Rule 11 有同一份 argv 與範例。

代打只換「誰敲指令」：高影響需求缺口與 Gherkin 的 PM 確認仍照 `rules/依產物推進判準.md` 停下來問。

## Good Example

- 這個例子是好的，因為未被派出的 session 輪到 specify 時派本機 session 代打並等回報。

```text
Phase 6 判定下一步是 specify、CLADE_DISPATCH_ID 為空 → herdr-session-handoff.ts --cwd <worktree> --coordinate … --table-row <列> --prompt-file <brief>（第一行 /specify <範圍>）
```

## Bad Example

- 這個例子是壞的，因為停下來請使用者親打，或自己讀那四支的檔照跑。

```text
Skill 工具拒絕 specify → Read specify/SKILL.md 照著做
```

# Rule 3 - clade overlay 只從本檔走得到，載入宿主 owner 時一併讀

- Level: `MUST`

三個 owner 各有一份 clade-owned 的 `specformula.md`，上游 `SKILL.md` 不會提到：bundle 內的 `rules/.workflow/bdd/specformula.md`、`rules/.workflow/technical-research/specformula.md`，以及公開入口 implement 目錄的 `implement/specformula.md`（與 implement 的 `SKILL.md` 同目錄）。載入這三個 owner 時 MUST 一併讀它，依該檔的適用條件套用（bdd 那份在後端 BDD techstack 是 SpecFormula 時不手寫 step definition；technical-research 那份給三題必問的 fleet 預設；implement 那份把 Phase 3 的三個 marker 改落在規格檔）。**NEVER** 因上游入口沒列就略過。

## Good Example

- 這個例子是好的，因為載入 bdd 時一併讀它的 clade-owned specformula.md。

```text
輪到 bdd red → 讀 rules/.workflow/bdd/SKILL.md ＋ rules/.workflow/bdd/specformula.md
```

## Bad Example

- 這個例子是壞的，因為因上游入口沒列就略過 overlay，在後端 BDD 是 SpecFormula 的專案手寫 step definition。

```text
「bdd 的 SKILL.md 沒提到 specformula.md」→ 手寫 step definition
```
