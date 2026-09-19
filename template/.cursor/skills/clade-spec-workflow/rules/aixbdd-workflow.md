---
description: aixbdd 需求到實作的 workflow 契約——plan package 是唯一迭代單位、truth 只由 truth owner skill 改、PM/RD 兩側入口順序、與 SpecFormula 的分工
paths: ['specs/plans/**', 'specs/truth/**', '.agents/constitution/**']
---
<!-- Clade native rule; source: rules/core/aixbdd-workflow.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# aixbdd Workflow 標準

> Upstream: <https://github.com/Waterball-Software-Academy/aixbdd>（Apache-2.0）。clade 端 `vendor/aixbdd/`（submodule），16 支 skill 鏡射到 `capabilities/modules/capabilities/aixbdd/skills/`。
>
> Cookbook：`~/offline/clade/vendor/snippets/aixbdd/`
>
> 執行框架的規約：[`specformula.md`](./specformula.md)

**核心命題**：aixbdd 切的是**職責**，不是階段。PM 定義「什麼結果才算通過驗收」，RD 把那份驗收標準落地成可執行的系統。所以 plan 是一次迭代的完整封裝（這次要改什麼），`specs/truth/**` 是系統當下的真相（現在長什麼樣）。兩者混在一起，就沒有任何地方回答得了「目前系統到底是什麼」。

**同一份 lifecycle 對 clade home 與每一個 consumer 生效。** package 是 `specs/plans/<work-id>/`，work id 由 `flow plan open` 鑄，`plan.md` 是 lifecycle 檔（結案後刪除，truth 持續維護，歷史走 git——這是 clade 適配，不宣稱上游 aixbdd 已如此設計）。九步的 PM／RD 職責在 clade home 一樣成立；差別只在 artifact 的**適用性**（CLI 工作沒有 UI 雛形、沒有 OpenAPI），而每一個省略都要在 `plan.md` § Decisions 寫一行工作特定理由。「clade 是標準層不是產品」**不是**省略理由——那句話在 2026-09-17 被撤回，它把「哪些 artifact 適用」誤讀成「整個流程適不適用」。`NNN-<slug>` 編號只剩一個用途：尚未遷移到 lifecycle 檔的 consumer 的過渡路徑（判準見 § clade lifecycle 適配與入口）。契約全文見 `specs/truth/work-lifecycle.md`。

## 與 `specformula.md` 的分工

aixbdd 產出可執行規格（`.feature` ＋ DSL），SpecFormula 執行它——前者是流程層、後者是 runtime，**兩條規約管的是同一條管線的兩端**。

## 何時用 / 不用

| 可觀察 predicate | 採用 |
| --- | --- |
| consumer 的 resolved manifest 宣告 `modules.capabilities` 同時包含 `specformula` 與 `aixbdd` | ✅ 本檔全部條款生效 |
| 只宣告 `specformula`，沒有 `aixbdd` | 執行層照 `specformula.md`；本檔不生效（自己手寫 `isa.yml` 與 `.feature` 是合法路徑） |
| 只宣告 `aixbdd`，沒有 `specformula` | 合法——aixbdd 對 BDD techstack 不預設答案（`/technical-research` 三題必問的第一題就是它）。此時本檔生效、`specformula.md` 不生效 |
| clade home（沒有 manifest，不是自己的 consumer） | ✅ 本檔全部條款生效——依據是 truth `specs/truth/work-lifecycle.md`，不是 capability 宣告 |
| 一次性 hotfix、純設定調整、無驗收標準可寫的工作 | ❌ 不用——九步走完的成本遠大於改動本身。這是**逐件工作**的判定，NEVER 讀成某個 repo 整體豁免 |

Capability predicate 讀取 consumer 的 neutral manifest reader：canonical `.clade/manifest.json` 優先，只有 canonical 缺席時才使用相容的 `.claude/hub.json`；兩份同時存在但內容衝突時 fail closed。判定一律使用 reader 的 `resolved` capabilities，NEVER 直接讀任一 runtime 的設定檔。

## 入口順序

照上游 README 的快速開始九步，**MUST 依序**，不可跳步。統一入口先做 constitution gate；只有規則 artifact 已確認不需變更，或 constitution 已完成，才建立／續跑 package：

| # | 入口 | 誰執行 | 產出落點 |
| --- | --- | --- | --- |
| 1 | `/constitution` | 共同 | `.agents/constitution/**`（需要新增或調整規則時；此 gate 在 package 判定前執行） |
| 2 | `/specify` | PM | lifecycle repo：`specs/plans/<work-id>/{spec.md,checklists/requirements.md}`，truth delta 意圖列寫進 `plan.md` § Truth delta（state=proposed）；未遷移 consumer：`specs/plans/NNN-<slug>/{spec.md,checklists/requirements.md,truth-delta.md}`。新需求永遠開新 work id，同一工作續跑同一份 |
| 3 | `/clarify-over-specs` | PM | 更新 `spec.md`（選用） |
| 4a | `/spec-by-example` → `/ui-plan` | PM | plan package 的 `features/acceptance/**`；UI 需求另產 `ui-plan.md` ＋靜態雛形 |
| 4b | `/technical-research` | RD | plan `research.md` ＋ truth `specs/truth/techstack.md` |
| 5 | PM 確認 Gherkin 與適用的 UI 雛形／review 後 handoff | PM → RD | —；UI 需求缺雛形或 review 才停在 PM confirmation gate，API-only 不建立 UI gate |
| 6 | `/system-analysis`（委派 `/api-plan`、`/data-plan`） | RD | lifecycle repo：plan `system-analysis.md`（`plan.md` 是 lifecycle 檔，NEVER 覆寫）；未遷移 consumer：plan `plan.md`。只有 PM gate 通過後可進入 |
| 7 | `/dsl-refine` | RD | truth `specs/truth/features/{backend,frontend}/**` 的 feature 與 `dsl.md` |
| 8 | `/tasks` | RD | plan `tasks.md` |
| 9 | `/implement`（`[BDD-GREEN]` / `[BDD-REFACTOR]` 委派 `/bdd`） | RD | 產品碼與測試 |

第 4 步的兩側**可以平行**，其餘 **MUST 序列**。`/truth-delta` 由 truth owner skill 自己呼叫，**NEVER** 手動執行。

**冷啟動入口**：一個沒有對話歷史的 Claude／Codex／Cursor task 收到新需求時，第一支 skill是 `work-route`——它先讀 `specs/truth/work-lifecycle.md` 與相關 truth，再判「續跑既有 work id」或「`flow plan open`」。純對話式規劃（user 只是在問、還沒要落地）**不寫 repo、不寫 flow**；user 明說要寫到外部草稿時，寫那個草稿、不鑄 work id。

## MUST

1. **每一次**需要持久接續的工作都 MUST 有且僅有一個 work id 與一份 package。lifecycle repo（clade home 與已遷移 consumer）：`flow plan open` 鑄 id 並建立 `specs/plans/<work-id>/plan.md`，`/specify` 在**同一個目錄**填 `spec.md`，同一工作續跑同一份，結案刪除。尚未遷移的 consumer 才由 `/specify` 建 `NNN-<slug>/`。**NEVER** 為同一工作開第二份 plan，**NEVER** 在 lifecycle repo 建 `NNN-` 目錄。
2. `specs/truth/**` 底下**每一個**檔案 MUST 只由它的 truth owner skill 寫：`techstack.md` 歸 `/technical-research`，`features/**` 與 `dsl.md` 歸 `/dsl-refine`。**每一個**其他入口（含 `/specify`、`/tasks`、`/implement`）都 MUST 把 truth 當唯讀。
3. **每一個** plan package 的 `tasks.md` 在開始動工之前，MUST 已綁定 work id 並 `export CLADE_WORK_ID=<id>`：lifecycle repo 的 id 在 `flow plan open` 那一刻就鑄好（`plan.md` frontmatter 的 `work_id`）；未遷移 consumer 跑 `node vendor/scripts/flow/flow.ts open <slug> --origin tasks:specs/plans/NNN-<slug>/tasks.md`。plan package 就是 clade `flow` 的 work carrier——**NEVER** 為同一個 plan package 開第二張卡，也 **NEVER** 因為「只是先跑個測試」跳過（那正是 `unattributed` 的來源）。
4. `/technical-research` 的三題必問（各端的 BDD techstack、測試策略、系統有哪些端）MUST 全部拍板才可寫 `research.md` 或 `techstack.md`。**「`spec.md` 的假設」與「範例檔的堆疊」都不算已回答**，只有使用者本輪原話、本輪 `/clarify` 的答案、或既有 `techstack.md` 已寫明且本輪沒改判才算。
5. 每一個 Gherkin 句型 MUST 在 DSL 有**恰好一個**權威 row。句型上提到介面根或下放到模組時，MUST 刪掉舊位置，**NEVER** 讓根與模組同時存在同一 row。

## NEVER

1. **NEVER 在 plan package 之外寫 acceptance feature**。驗收 Gherkin 屬於 `specs/plans/<work-id>/features/acceptance/**`（未遷移 consumer：`specs/plans/NNN-<slug>/features/acceptance/**`）；拆解後的可執行 interface feature 才進 `specs/truth/features/**`。兩者寫反的症狀不是報錯，是 `specs/truth/` 逐漸累積成一份沒有人維護的需求史。
2. **NEVER 用 spectra 詞彙描述 aixbdd 的產出**——`openspec/changes/`、`change`、`propose`、`archive` 在這條管線裡沒有對應物。「開一個 change」在 aixbdd 是 `/specify` 建 plan package，兩者的生命週期與歸檔方式都不同，混用會讓兩套流程的 skill 互相誤觸發。
3. **NEVER 讓 `/bdd` 或 `/implement` 去補寫規格**。它們發現 feature 或 DSL 有缺口時 MUST 停下回交 `/dsl-refine`。就地補寫的那一行不會回到 truth，下一輪 `/dsl-refine` 會把它蓋掉。
4. **NEVER 在 `/implement` 未取得使用者同意前 git commit**——上游 SOP 的 Phase 5 明寫要先問。

## Anti-pattern

| 反模式 | 為何錯 | 正解 |
| --- | --- | --- |
| 小改動直接改一份**已結案**工作的 `spec.md` | 舊 plan 是歷史，改掉之後沒有任何地方看得出這次改了什麼 | 開新 work id（lifecycle repo：`flow plan open`；未遷移 consumer：`/specify` 開 `004-<slug>`） |
| `/specify` 順手改 `specs/truth/contracts/openapi.yaml` | truth 有 owner；非 owner 的寫入下一輪會被覆蓋 | 記 ADD / MODIFY / DELETE 意圖列（lifecycle repo：`plan.md` § Truth delta；未遷移 consumer：`truth-delta.md`），交給 owner skill |
| 「clade 是標準層不是產品，所以只寫一份薄 plan 就好」 | 把 artifact 適用性誤讀成流程豁免；沒有 acceptance feature 的工作，便宜模型接不了、close gate 也沒有東西可驗 | 走九步，省略的 artifact 逐一在 `plan.md` § Decisions 寫理由 |
| 同一句型同時出現在 `{介面}/dsl.md` 與 `{介面}/{模組}/dsl.md` | 每個 step 必須恰好命中一個 row，duplicate 讓命中結果取決於載入順序 | 判唯一歸屬後刪掉另一份 |
| `/technical-research` 從 `spec.md` 的「純前端」假設推論不用問端 | 那是假設不是答案；起始專案照這樣走會漏掉整個後端 | 走 `/clarify` 問三題 |
| 開 worktree / 派 pane 才想到要建 work 卡 | plan package 已經是 carrier，事後補掛不會發生 | 第 3 條的 `flow open` 排在動工之前 |

## clade lifecycle 適配與入口

上游 skill 以 `NNN-<slug>`、`plan.md`（系統分析）、`truth-delta.md` 為檔名假設。lifecycle repo 用同一套職責、不同的載體；skill（含 clade fork 上的 patch）判「這是不是 lifecycle package」的**唯一**判準：

> package 內 `plan.md` 的 frontmatter **同時**含 `work_id:` 與 `truth_baseline:`。

**NEVER** 用 repo 名、manifest 欄位、或「`specs/truth/work-lifecycle.md` 存不存在」代替這條——那三者都回答不了「眼前這個 package 是哪一種」。

| 上游名 | lifecycle repo | owner |
| --- | --- | --- |
| `specs/plans/NNN-<slug>/` | `specs/plans/<work-id>/`（`flow plan open` 鑄） | work-lifecycle |
| `truth-delta.md` | `plan.md` § Truth delta 表（`id／action／unit／reason／state`，`flow plan apply-delta` 機讀） | work-lifecycle |
| `plan.md`（系統分析） | `system-analysis.md` | RD（`/system-analysis`） |
| `spec.md`、`checklists/requirements.md`、`features/acceptance/**`、`research.md`、`tasks.md`、`ui-plan.md`＋`ui/**` | 同名 | 同上游 |
| — | `briefs/**`（派工 brief）、`evidence/**`（cucumber JSON report ＋ `receipts.jsonl`，供 `acceptance-verdicts.ts` 讀） | 主線／runner |

**每一個**省略的 artifact 都 MUST 在 `plan.md` § Decisions 有一行工作特定理由；`flow plan readiness` 對缺 `spec.md`、缺 acceptance feature、缺 `acceptance_command` 的 package 一律拒絕，理由不寫在 Decisions 裡就等於沒有理由。

## Reference signal（不 block）

aixbdd 側目前沒有專屬 audit script。落地程度由 `node scripts/audit-specformula-adoption.ts` 的 capability 宣告欄位間接反映——**NEVER** 把那張表讀成 aixbdd 的採用度，它量的是執行層。
