<!-- clade-owned: not mirrored from upstream; see vendor/snippets/specformula/README.md -->

# `/implement` on SpecFormula

`techstack.md` 的後端 BDD techstack 是 **SpecFormula** 時，本檔覆蓋 `SKILL.md` 對測試層 task 的執行方式。One-Shot、不能跳步驟、驗證後立刻回寫 `[X]`、全綠才問 commit —— 這些全部照 `SKILL.md`，本檔不重述。

## 覆蓋了什麼

`SKILL.md` 的 Phase 3 說「`[BDD-ALIGN]`、`[BDD-REMOVE]`、`[BDD-RED]` 由 subagent 讀 `dsl.md` 該列的 `StepDef 實作語意` **寫測試層**」。在 SpecFormula 上沒有可寫的測試層 —— 那三個 marker 落在規格檔上。

| marker | `SKILL.md` 的動作 | SpecFormula 上的動作 |
| --- | --- | --- |
| `[BDD-ALIGN]` | 依 truth-delta 對齊既有測試 | 把 `dsl.md` 該列轉成 / 更新 `dsl.yml` 的 `dsl_steps[]`；句型對不上 `isa.yml` 才補 `instructions[]` |
| `[BDD-REMOVE]` | 刪掉被淘汰的測試 | 刪 `dsl.yml` 的對應 `dsl_steps[]` 與 `.feature` 的 `Example`。**`isa.yml` 的指令 regex 是共用資產，NEVER 順手刪** |
| `[BDD-RED]` | 寫出失敗的測試 | 只補 `.feature` 的 `Example`。紅 MUST 紅在斷言上 |
| `[BDD-GREEN]` / `[BDD-REFACTOR]` | 委派 `/bdd` | 不變 —— 委派 `/bdd`，它會讀同目錄的 `specformula.md` |

## MUST

1. `[BDD-ALIGN]` 的轉換 MUST 照 `~/offline/clade/vendor/snippets/aixbdd/README.md` § dsl.md → dsl.yml 轉換規則。**每一個** Then 句型的 `StepDef 實作語意` 只要出現 `權威狀態` 或 `再讀確認`，就 MUST 展開成 `response_validate` **加** `entity_validate` 兩個 `isa_steps`，不是只有前者。漏掉第二個不會報錯，只會讓那條 Then 比 `dsl.md` 弱。
2. Phase 3 的三個 marker 全部完成、review 通過之前，**NEVER** 進 Feature Green —— 這條在 SpecFormula 上更要緊：`dsl.yml` 沒對齊時 `.feature` 會以 `DSL_ISA_INSTRUCTION_NOT_FOUND` 失敗，而那個紅看起來跟「功能還沒做」一模一樣。
3. 驗證 MUST 是實跑 `pnpm test:bdd`（需要 `supabase start` 與 `SPECFORMULA_TEST=1 pnpm dev` 都在跑）。**NEVER** 用「規格改好了」當 task 的完成證據。
4. plan package 的 work 卡在動工前建好（`.claude/rules/aixbdd-workflow.md` § MUST 3）。`Parallel Hint` 批次派 subagent 時 **NEVER** 為每個 `[P]` 另開 root 卡 —— worker 自動鑄子卡並掛到 ambient。

## Anti-pattern

| 反模式 | 為何錯 | 正解 |
| --- | --- | --- |
| `[BDD-ALIGN]` 去 `features/steps/` 建檔 | SpecFormula 不手寫 step def，建了會撞成 ambiguous step | 改 `dsl.yml` / `isa.yml` |
| `[BDD-REMOVE]` 把 `isa.yml` 的指令 regex 一起刪 | 那是全專案共用的句型，其他 feature 立刻變 undefined | 只刪 `dsl_steps[]` 與 `Example` |
| 看到 `DSL_ISA_INSTRUCTION_NOT_FOUND` 就進 green 補產品碼 | 那是規格沒接上，不是功能沒做 | 回 Phase 3 把 `dsl.yml` 對齊 |
