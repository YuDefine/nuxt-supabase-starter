# SpecFormula 契約載入判準

觸發點：`SKILL.md` Phase 4 step 3（`specs/truth/techstack.md` 的後端 BDD techstack 是 SpecFormula 時）。

# Rule 1 - SpecFormula 契約只在宿主 owner 的指定時機載入

- Level: `MUST`

`specs/truth/techstack.md` 的後端 BDD techstack 是 SpecFormula 時，下列四支上游契約由表中的宿主 owner 在該步載入，與宿主契約一起執行；techstack 未採 SpecFormula 就一支都不載。它們規定 SpecFormula 的檔案形狀，不取代宿主的 truth 所有權、PM gate 或驗收。**NEVER** 用「宿主 `SKILL.md` 沒提到」略過；也 **NEVER** 在宿主以外的步驟自行改寫它們管的檔。

| 契約 | 宿主 owner 與時機 | 本步必須做到 |
| --- | --- | --- |
| `specformula-config`（含 `nuxt.md`、`java.md`、`custom-instruction.md`） | technical-research 選定 SpecFormula 時；implement 的 Setup task 安裝與接線時；寫 `dsl.yml` 的 `isa_steps` 找不到可用 ISA 指令、要新增 `isa.yml` 指令時 | 選定時確認 `isa.yml` 表達得了本專案的資料源與 `db_type`，限制寫進 techstack。Nuxt 專案的安裝照 clade-owned 的 `rules/.workflow/specformula-config/nuxt.md` 與 `~/offline/clade/vendor/snippets/specformula/` cookbook。新的業務句型先在 `dsl.md` 立列、轉寫成 `dsl.yml` 的 `dsl_steps`；`isa_steps` 找不到可用的 ISA 指令才加 `instructions[]` regex，框架做不到的才用 `custom`（`custom-instruction.md`）。**NEVER** 把業務句型直接註冊成 `instructions[]` 來跳過 `dsl.yml` |
| `specformula-api-spec` | api-plan Phase 3 寫 truth OpenAPI 時 | `isa.yml` 的 `config.api.resource_path` 讀的就是 api-plan 維護的 `specs/truth/contracts/**`，不另存一份 OpenAPI。每個 operation 的 `summary` 全域唯一，用業務語言的「動詞＋名詞」。`isa.yml` 指向另一份 OpenAPI 時不手動同步兩份，交 tasks 排一條把 `isa.yml` 改指 truth 的 task |
| `specformula-entity-spec` | data-plan 本輪有 table／field 語意變更時，同一輪 | 更新 `isa.yml` 各 `config.data.source[].resource_path` 下的 `entity_to_table_mapping.yml`（業務語言實體名）與 DDL（語法依該 source 的 `db_type`），與 DBML 同一語意；落在 `specs/truth/data/**` 內時一併列進本輪 delta。只改 API 的工作不捏造 entity |
| `specformula-feature`（含各指令檔） | 寫 `dsl.yml` 的 `isa_steps` 時：implement `[BDD-ALIGN]`，或 bdd `red` 就地補 `dsl.yml`（`rules/.workflow/bdd/specformula.md` § 缺口回交的邊界不變） | 先讀專案 `isa.yml` 的 `instructions[].format`，`isa_steps` 的指令句與符號（`>`、`<`、`$`、`&`）照該契約與各指令檔；`dsl.yml` 的轉換規則仍照 `implement/specformula.md`。它的範例把 ISA 指令句寫在 `.feature`，那是框架自身的示範，**NEVER** 照它寫 truth `.feature`：`.feature` 的 `Example`（bdd `red`、implement `[BDD-RED]`）只用 `dsl.md` 已立列的業務句型，照 dsl-refine 的 `rules/介面Gherkin原子化與單一Act判準.md` 寫（每個 Example 恰一個 `When`，Given 寫 PM 看得懂的業務狀態） |

採 SpecFormula 時，`rules/依產物推進判準.md` 的表 technical-research、api-plan、data-plan、implement、bdd 這幾步另依本表載入對應契約；那張表沒列到的步驟不載。

## Good Example

- 這個例子是好的，因為依 techstack 決定是否載入 SpecFormula 契約，並在宿主的指定時機載入。

```text
techstack 後端 BDD 是 SpecFormula、輪到 bdd red → 讀 rules/.workflow/bdd/SKILL.md＋rules/.workflow/bdd/specformula.md；.feature 補 Example 用 dsl.md 的業務句型，句型在 dsl.yml 沒有對應 dsl_steps 才載入 specformula-feature 寫 isa_steps
```

## Bad Example

- 這個例子是壞的，因為因宿主 SKILL.md 沒提到就略過契約，或在宿主以外的步驟自行改寫契約管的檔。

```text
bdd red 載入 specformula-feature 後照它的範例寫 .feature → Background 堆「準備一個…, with table:」、同一 Example 兩個 When，跳過 dsl.md 與 dsl.yml
```

# Rule 2 - 下游契約提到的流程名與 script 前綴回位置表解析

- Level: `MUST`

下游契約提到 `/tasks`、`/bdd`、`/truth-delta` 等流程時回 `rules/owner載入位置判準.md` 的位置表解析，由 orchestrator 載入契約執行，不把缺少 slash UI 當成能力缺失。上游契約的 `.agents/skills/<owner>/scripts/...` 前綴換成當前 runtime 的 `work-route/rules/.workflow/<owner>/`，保留腳本與參數。尤其 gherkin-and-dsl Phase 6 必須實際執行 `uv run <work-route-root>/rules/.workflow/gherkin-and-dsl/scripts/audit_feature_dsl_topology.py --root <features-root>`；其中 `<work-route-root>` 是位置表所列當前 runtime 的 skill 根，`<features-root>` 是 **truth 的介面根**（含 `dsl.md` 的那一層，例如 `specs/truth/features/cli`）。plan package 的 `features/acceptance/` 沒有 `dsl.md`，拿它當 root 每一個 step 都會報找不到 DSL row——plan 端 acceptance 的對應檢查是 `flow plan readiness <work-id>`（dry-run 無 undefined／ambiguous step）；SpecFormula 的 ISA 指令句永遠查得到定義，dry-run 分不出它與業務句型，「步驟已綁定」另要 `rules/驗收與交付判準.md` Rule 3 的兩項證據。保留稽核輸出，失敗交回該 owner，不因路徑搬移而略過。

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
