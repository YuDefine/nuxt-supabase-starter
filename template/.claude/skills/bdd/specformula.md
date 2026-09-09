<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/bdd/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-owned: not mirrored from upstream; see vendor/snippets/specformula/README.md -->

# `/bdd` on SpecFormula

`techstack.md` 的後端 BDD techstack 是 **SpecFormula** 時，本檔覆蓋 `SKILL.md` 的三個入口對「要改哪些檔」的假設。其餘（單一 slice、單一 requested step、缺口回交 `/dsl-refine`）全部照 `SKILL.md`，本檔不重述。

## 覆蓋了什麼

`SKILL.md` 假設 RD 手寫 step definitions —— 那是 behave / Cucumber-JVM 的形狀。SpecFormula 的 step definition 由 `isa.yml` 的 regex **動態註冊**，人不寫。所以三個入口的落點整組不同。

| `SKILL.md` 說 | SpecFormula 上實際是 |
| --- | --- |
| 寫 / 改 step definitions | 改 `isa.yml` 的 `instructions[]`（新句型）或 `dsl.yml` 的 `dsl_steps[]`（句型展開成哪幾個 ISA 指令） |
| focused rerun 某支測試檔 | `pnpm test:bdd -- --name '<Example 標題>'`，從 repo root |
| test fixture / helper / abstraction | `entity_setup` 的 DataTable。**NEVER** 建平行的 fixture 層 |

## 三個入口的落點

| 入口 | 在 SpecFormula 上做什麼 | 完成訊號 |
| --- | --- | --- |
| `red` | 只動規格側：`.feature` 補 `Example`；句型沒有對應 DSL row 就先補 `dsl.yml`，句型連 ISA 指令都對不上才動 `isa.yml`。**NEVER** 為了讓它紅就去動產品碼 | `pnpm test:bdd` 對該 Example 紅，且**紅在斷言上**，不是紅在 `DSL_ISA_INSTRUCTION_NOT_FOUND` 或 undefined step |
| `green` | 只動 `server/**` 產品碼，補到剛好通過當前 failure | 該 Example 綠，其餘維持原狀 |
| `refactor` | 只動產品碼結構。`.feature` / `dsl.yml` / `isa.yml` 在這個入口 **MUST 一行都不動** | 全綠不變 |

## MUST

1. **NEVER 手寫 step definition 去接 `isa.yml` 已涵蓋的六個內建指令**。要新句型就加 `isa.yml` 的 `instructions[]` regex；框架真的做不到的行為才用 `instruction_type: custom`。理由與症狀（ambiguous step，而訊息指向你的檔）在 `.claude/rules/specformula.md` § NEVER 1。
2. **`red` 的紅 MUST 是斷言紅。** undefined step 與 `DSL_ISA_INSTRUCTION_NOT_FOUND` 都是**接線沒接上**，不是有效失敗訊號——照它去寫 green，補出來的是一個沒有被任何斷言保護的實作。逐字反開脫：「反正它是紅的，可以進 green 了」。
3. 動到 `dsl.yml` 或 `isa.yml` 時 MUST 同時確認 `specs/truth/features/**` 的 `dsl.md` 仍是同一份語意。**兩份都要改**，`dsl.md` 是 truth、`dsl.yml` 是它給框架的形式。只改後者的話下一輪 `/dsl-refine` 會把它蓋掉。
4. 業務時間一律走 `server/utils/time-service.ts`；`green` 補碼時 **NEVER** 寫 `new Date()`。

## 缺口回交的邊界不變

`.feature` 或 `dsl.md` 有高影響缺口 → 停下回交 `/dsl-refine`。**`dsl.yml` 是例外**：它是 `dsl.md` 的機械轉寫（轉換規則在 `~/offline/clade/vendor/snippets/aixbdd/README.md` § 轉換規則），語意沒變時可以就地補，語意要變就跟 `dsl.md` 一起回交。
