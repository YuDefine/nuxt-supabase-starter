---
description: aixbdd 需求到實作的 workflow 契約——plan package 是唯一迭代單位、truth 只由 truth owner skill 改、PM/RD 兩側入口順序、與 SpecFormula 的分工
paths: ['specs/plans/**', 'specs/truth/**', '.agents/constitution/**']
---
<!-- Clade native rule; source: rules/core/aixbdd-workflow.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# aixbdd Workflow 標準

> Upstream: <https://github.com/Waterball-Software-Academy/aixbdd>（Apache-2.0）。clade 端 `vendor/aixbdd/`（submodule）。公開入口 `specify`、`clarify`、`system-analysis`、`implement` 鏡射到 `capabilities/modules/capabilities/aixbdd/skills/`，其餘上游 skill 鏡射到同 module 的 `references/upstream-skills/`，由 clade 自有的 `work-route` 載入。
>
> Cookbook：`~/offline/clade/vendor/snippets/aixbdd/`
>
> 執行框架的規約：[`specformula.md`](./specformula.md)
>
> 導入 aixbdd 之前留下的舊測試（凍結、吸收、新測試落點）：[[legacy-tests]]

aixbdd 切的是**職責**：PM 定義驗收標準，RD 落地成可執行系統。plan 是一次迭代的封裝（這次要改什麼），`specs/truth/**` 是系統當下的真相。aixbdd 產出可執行規格（`.feature` ＋ DSL），SpecFormula 執行它。

**同一份 lifecycle 對 clade home 與每一個 consumer 生效。** package 是 `specs/plans/<work-id>/`，work id 由 `flow plan open` 鑄，`plan.md` 是 lifecycle 檔（結案後刪除，歷史走 git；這是 clade 適配）。差別只在 artifact 的**適用性**（CLI 工作沒有 UI 雛形、沒有 OpenAPI）：工作種類（`work_kind`）決定的省略由 gate 依種類判定，其餘每一個省略都要在 `plan.md` § Decisions 寫一行工作特定理由。「clade 是標準層不是產品」**不是**省略理由。`NNN-<slug>` 只剩未遷移 consumer 的過渡用途。契約全文見 `specs/truth/work-lifecycle.md`。

## 何時用 / 不用

| 可觀察 predicate | 採用 |
| --- | --- |
| consumer 的 resolved manifest 宣告 `modules.capabilities` 同時包含 `specformula` 與 `aixbdd` | ✅ 本檔全部條款生效 |
| 只宣告 `specformula`，沒有 `aixbdd` | 執行層照 `specformula.md`；本檔不生效（自己手寫 `isa.yml` 與 `.feature` 是合法路徑） |
| 只宣告 `aixbdd`，沒有 `specformula` | 合法——aixbdd 對 BDD techstack 不預設答案（`/technical-research` 三題必問的第一題就是它）。此時本檔生效、`specformula.md` 不生效 |
| clade home（沒有 manifest，不是自己的 consumer） | ✅ 本檔全部條款生效——依據是 truth `specs/truth/work-lifecycle.md`，不是 capability 宣告 |
| hotfix（線上出事、要先修） | ✅ 用，允許先修：`flow plan open --hotfix` 會帶一條「補迴歸 scenario（hotfix 先修）」Open work，沒補完結不了案；補的時候依出錯的行為原本有沒有 scenario，以 `flow plan set-kind` 定為 `bug-covered` 或 `bug-uncovered` |
| 純設定調整、無驗收標準可寫的工作；沒有 I/O 的純邏輯 bug（計算、解析、格式化、邊界值：迴歸落 unit test，與修正同一個 commit） | ❌ 不用。這是**逐件工作**的判定，NEVER 讀成某個 repo 整體豁免 |

Capability predicate 讀取 consumer 的 neutral manifest reader：canonical `.clade/manifest.json` 優先，只有 canonical 缺席時才使用相容的 `.claude/hub.json`；兩份同時存在但內容衝突時 fail closed。判定一律使用 reader 的 `resolved` capabilities，NEVER 直接讀任一 runtime 的設定檔。

## 入口順序

照上游 README 的快速開始九步，**MUST 依序**，不可跳步。統一入口先做 constitution gate；只有規則 artifact 已確認不需變更，或 constitution 已完成，才建立／續跑 package：

| # | 入口 | 誰執行 | 產出落點 |
| --- | --- | --- | --- |
| 1 | `/constitution` | 共同 | `.agents/constitution/**`（需要新增或調整規則時；此 gate 在 package 判定前執行） |
| 2 | `/specify` | PM | lifecycle repo：`specs/plans/<work-id>/{spec.md,checklists/requirements.md}`，truth delta 意圖列寫進 `plan.md` § Truth delta（state=proposed）；未遷移 consumer：`specs/plans/NNN-<slug>/{spec.md,checklists/requirements.md,truth-delta.md}`。新需求永遠開新 work id，同一工作續跑同一份 |
| 3 | `/clarify-over-specs` | PM | 更新 `spec.md`（選用） |
| 4a | `/spec-by-example` | PM | plan package 的 `features/acceptance/**`；UI 需求另備可供 PM 確認的設計證據（design／review owner，**不是** `/ui-plan`） |
| 4b | `/technical-research` | RD | plan `research.md` ＋ truth `specs/truth/techstack.md` |
| 5 | PM 確認 Gherkin 與適用的 UI 設計證據後 handoff | PM → RD | —；UI 需求缺設計證據或 review 才停在 PM confirmation gate，API-only 不建立 UI gate |
| 6 | `/system-analysis`（委派 `/api-plan`、`/data-plan`、`/ui-plan`） | RD | lifecycle repo：plan `system-analysis.md`（`plan.md` 是 lifecycle 檔，NEVER 覆寫）；未遷移 consumer：plan `plan.md`。`/ui-plan` 讀分析 handoff 與本輪 truth delta 產 `ui/ui-plan.md`＋`ui/*.html`，改到使用者可見行為時回第 5 步。只有 PM gate 通過後可進入 |
| 7 | `/dsl-refine` | RD | truth `specs/truth/features/{backend,frontend}/**` 的 feature 與 `dsl.md` |
| 8 | `/tasks` | RD | plan `tasks.md` |
| 9 | `/implement`（`[BDD-GREEN]` / `[BDD-REFACTOR]` 委派 `/bdd`） | RD | 產品碼與測試 |

第 4 步的兩側**可以平行**，其餘 **MUST 序列**。`/truth-delta` 由 truth owner skill 自己呼叫，**NEVER** 手動執行。

`/ui-plan` 的時序跟上游 `ui-plan/SKILL.md`（輸入含 system-analysis handoff 與 truth-delta），不跟上游 README 快速開始第 4 步（Charles 2026-09-27 裁決；兩者的矛盾待向上游回報）。**NEVER** 在 system-analysis 之前叫 `/ui-plan`。

表中名稱一律是上游 skill 名。consumer 端只有 `/specify`、`/clarify`、`/system-analysis`、`/implement` 與 `work-route` 是可直接叫的 skill；`/constitution`、`/clarify-over-specs`、`/spec-by-example`、`/ui-plan`、`/technical-research`、`/api-plan`、`/data-plan`、`/dsl-refine`、`/tasks`、`/bdd`、`/truth-delta`、`/gherkin-and-dsl` 沒有同名 slash 入口，由 `work-route` 依它的 owner 表載入上游契約執行。

**冷啟動入口**：一個沒有對話歷史的 Claude／Codex／Cursor task 收到新需求時，第一支 skill是 `work-route`——它先讀 `specs/truth/work-lifecycle.md` 與相關 truth，再判「續跑既有 work id」或「`flow plan open`」。純對話式規劃（user 只是在問、還沒要落地）**不寫 repo、不寫 flow**；user 明說要寫到外部草稿時，寫那個草稿、不鑄 work id。

## MUST

1. **每一次**需要持久接續的工作都 MUST 有且僅有一個 work id 與一份 package。lifecycle repo（clade home 與已遷移 consumer）：`flow plan open` 鑄 id 並建立 `specs/plans/<work-id>/plan.md`，`/specify` 在**同一個目錄**填 `spec.md`，同一工作續跑同一份，結案刪除。尚未遷移的 consumer 才由 `/specify` 建 `NNN-<slug>/`。**NEVER** 為同一工作開第二份 plan，**NEVER** 在 lifecycle repo 建 `NNN-` 目錄。
2. `specs/truth/**` 底下**每一個**檔案 MUST 只由它的 truth owner skill 寫：`techstack.md` 歸 `/technical-research`，`features/**` 與 `dsl.md` 歸 `/dsl-refine`。**每一個**其他入口（含 `/specify`、`/tasks`、`/implement`）都 MUST 把 truth 當唯讀。
3. **每一個** plan package 的 `tasks.md` 在開始動工之前，MUST 已綁定 work id 並 `export CLADE_WORK_ID=<id>`：lifecycle repo 的 id 在 `flow plan open` 那一刻就鑄好（`plan.md` frontmatter 的 `work_id`）；未遷移 consumer 跑 `node vendor/scripts/flow/flow.ts open <slug> --origin tasks:specs/plans/NNN-<slug>/tasks.md`。plan package 就是 clade `flow` 的 work carrier——**NEVER** 為同一個 plan package 開第二張卡，也 **NEVER** 因為「只是先跑個測試」跳過（那正是 `unattributed` 的來源）。
4. `/technical-research` 的三題必問（各端的 BDD techstack、測試策略、系統有哪些端）MUST 全部拍板才可寫 `research.md` 或 `techstack.md`。**「`spec.md` 的假設」與「範例檔的堆疊」都不算已回答**，只有使用者本輪原話、本輪 `/clarify` 的答案、或既有 `techstack.md` 已寫明且本輪沒改判才算。
5. 每一個 Gherkin 句型 MUST 在 DSL 有**恰好一個**權威 row。句型上提到介面根或下放到模組時，MUST 刪掉舊位置，**NEVER** 讓根與模組同時存在同一 row。

## NEVER

1. **NEVER 在 plan package 之外寫 acceptance feature**。驗收 Gherkin 屬於 `specs/plans/<work-id>/features/acceptance/**`（未遷移 consumer：`specs/plans/NNN-<slug>/features/acceptance/**`）；拆解後的可執行 interface feature 才進 `specs/truth/features/**`。修 bug 與重構的迴歸錨點寫進 truth 裡涵蓋該行為的既有介面 feature（加 Example 列或同檔加 Scenario，來源註解 `# 來源：work <work-id>`）——它是介面 feature 的現行行為，**不是** acceptance feature，plan 結案後仍留在 truth。
2. **NEVER 用 spectra 詞彙描述 aixbdd 的產出**——`openspec/changes/`、`change`、`propose`、`archive` 在這條管線裡沒有對應物。混用會讓兩套流程的 skill 互相誤觸發。
3. **NEVER 讓 `/bdd` 或 `/implement` 去補寫規格**。它們發現 feature 或 DSL 有缺口時 MUST 停下回交 `/dsl-refine`。
4. **NEVER 在 `/implement` 未取得使用者同意前 git commit**——上游 SOP 的 Phase 5 明寫要先問。

## Anti-pattern

| 反模式 | 為何錯 | 正解 |
| --- | --- | --- |
| 小改動直接改一份**已結案**工作的 `spec.md` | 舊 plan 是歷史，改掉之後沒有任何地方看得出這次改了什麼 | 開新 work id（lifecycle repo：`flow plan open`；未遷移 consumer：`/specify` 開 `004-<slug>`） |
| `/specify` 順手改 `specs/truth/contracts/openapi.yaml` | truth 有 owner；非 owner 的寫入下一輪會被覆蓋 | 記 ADD / MODIFY / DELETE 意圖列（lifecycle repo：`plan.md` § Truth delta；未遷移 consumer：`truth-delta.md`），交給 owner skill |

## clade lifecycle 適配與入口

上游 skill 以 `NNN-<slug>`、`plan.md`（系統分析）、`truth-delta.md` 為檔名假設。lifecycle repo 用同一套職責、不同的載體；skill 判「這是不是 lifecycle package」的**唯一**判準（目前由 fork `clade/main` 上的 patch 承載，屬 § 上游最新為準 的待撤回存量，不是先例）：

> package 內 `plan.md` 的 frontmatter **同時**含 `work_id:` 與 `truth_baseline:`。

**NEVER** 用 repo 名或 manifest 欄位代替這條。`specs/truth/work-lifecycle.md` 是否存在只決定下一件**新工作**走 `flow plan open` 還是 `NNN-<slug>`（該檔 § Carriers）。

| 上游名 | lifecycle repo | owner |
| --- | --- | --- |
| `specs/plans/NNN-<slug>/` | `specs/plans/<work-id>/`（`flow plan open` 鑄） | work-lifecycle |
| `truth-delta.md` | `plan.md` § Truth delta 表（`id／action／unit／reason／state`，`flow plan apply-delta` 機讀） | work-lifecycle |
| `plan.md`（系統分析） | `system-analysis.md` | RD（`/system-analysis`） |
| `spec.md`、`checklists/requirements.md`、`features/acceptance/**`、`research.md`、`tasks.md`、`ui/ui-plan.md`＋`ui/*.html` | 同名 | 同上游 |
| — | `briefs/**`（派工 brief）、`evidence/**`（cucumber JSON report ＋ `receipts.jsonl`，供 `acceptance-verdicts.ts` 讀） | 主線／runner |

`flow plan readiness` 依 `plan.md` frontmatter 的 `work_kind` 決定要求集，**不**讀 § Decisions 的省略理由：`behavior`、`bug-uncovered` 與未宣告的 plan 要求完整集（`spec.md`、acceptance feature、`acceptance_command` 等）；`bug-covered` 與全部錨點都是 NOOP 的 `refactor` 改要求迴歸錨點，不要求 `spec.md` 與 acceptance feature。delta 形狀與種類不符時回 `kind-delta-mismatch`，改判走 `flow plan set-kind`。值域與要求集全文見 `specs/truth/work-lifecycle.md` § Package。

## clade 伴隨：truth feature 接到可執行測試

上游只規定 truth 佈局與 DSL 形狀；runner 怎麼讀 truth、未驗證的 feature 怎麼標、step 與 DSL 怎麼對帳，依 `~/offline/aixbdd-MES-Benchmark` 補成下列 MUST（括號是 `specs/plans/W-2026-10-02-aixbdd-benchmark-standard/plan.md` 對照表列號）。適用：本檔生效且 `specs/truth/features/**` 有 `.feature` 的 repo。設定步驟與範本在 cookbook `vendor/snippets/aixbdd/README.md` § 可執行測試接線。

1. **runner 直接讀 truth**（B1）：**每一個** BDD runner 的 feature 來源 MUST 是 `specs/truth/features/<介面>/`。工具要求 feature 位在自己目錄底下時（playwright-bdd），用進版控的相對目錄連結指回 truth。**NEVER** 把 feature 複製到 `src/test/resources`、`e2e/features` 這類副本——副本一分岔，綠燈測的就不是 truth。
2. **驗證狀態只有三種**（B2）：truth 的**每一支** feature MUST 落在下表其中一種。`@code-mismatch` 與每個疑點 MUST 掛 `# [need clarification] Q-<模組>-n …`，寫明實際行為與程式碼位置。

   | 標示 | 意思 | runner |
   | --- | --- | --- |
   | 無標籤 | 有 step definition，已執行並通過 | 執行 |
   | `@code-mismatch` | 規格寫規則原意，產品碼沒做到，執行會紅 | 執行；紅燈待裁決改碼或改規格 |
   | `@unverified` | 從程式碼逆向補齊，句型可能沒有 step definition，未執行 | 預設排除（tag 過濾 `not @unverified`），NEVER 算進綠燈或覆蓋數 |

   刻意把現有缺陷鎖成規格的 Rule，標題寫「現況鎖定，非期望行為」並掛 Q 註解，**不**標 `@code-mismatch`（它會通過）。
3. **step 與 DSL 雙向機械對帳**（B4）：手寫 step definition 的**每一個**介面 MUST 在 CI 接一支檢查，四項任一不過就 exit 1：① 每個 step definition 在該介面 `dsl.md` 聯集（介面根＋各模組）恰好一列，每列句型恰有一個 step definition；② 語意欄標「未實作」的句型沒有 step definition，且只被 `@unverified` feature 使用；③ 產生器（如 `bddgen`）輸出 missing step 時判紅，不採信它的 exit 0；④ 產出 0 支 spec 或 0 個 scenario 判紅（路徑斷了也是 exit 0）。SpecFormula 路徑不手寫 step，改照 cookbook § dsl.md → dsl.yml 轉換規則。
4. **三處同一組模組鍵**（B6）：`specs/truth/contracts/`、`specs/truth/features/backend/`、`specs/truth/features/frontend/` 的模組 MUST 用同一組鍵（同名的檔或目錄；`NN-` 前綴可選，用了就三處一致）。只存在其中一端的模組可以在別處缺席，**NEVER** 讓同一模組在不同處換名。

## clade overlay

上游沒有而 clade 需要的行為，只走兩條 clade-owned 路徑，不改上游檔：

- **同目錄 overlay**（registry `mirror.cladeOwnedFiles`，sync 不覆寫）：`specformula.md`。上游 `SKILL.md` 不會提到它們，入口是 `work-route` § 2 的 overlay 表；直接叫公開入口時由本表指路。執行下列 owner 時 MUST 一併讀該 overlay：

| Owner | overlay | 何時套用 |
| --- | --- | --- |
| `/technical-research` | `specformula.md` | manifest 宣告 `specformula` capability 時：提供三題必問的 fleet 預設，供 techstack 選型確認 |
| `/implement`、`/bdd` | `specformula.md` | 後端 BDD techstack 是 SpecFormula 時 |

- **伴隨覆寫 rule**（registry `mirror.overridePointer`）：lifecycle 落點（L 族）與 canonical doctor（D 族）寫在 `work-route/rules/上游覆寫-lifecycle落點與doctor.md`，逐條列出被覆寫的上游原句（anchor）與判準，由 `scripts/audit-upstream-overrides.ts` 對 pin 的上游逐字核對。doctor 的「tasks 產出後跑一次、implement 每個 task 回寫 `[X]` 前各跑一次」只住在那份檔，這裡不另立 overlay 檔。

overlay 只**追加**步驟，**NEVER** 改寫上游已定義的語意（Setup 何時建立、task 完成條件的既有項目）；要改上游語意就回報上游，不是寫 overlay。

## 上游最新為準

**觸發**：**每一次** bump aixbdd pin、跑 `sync-upstream-mirrors --only aixbdd`、在 fork `Charles5277/aixbdd` 的 `clade/main` 加 commit，或在 clade 源檔（`rules/**`、`capabilities/**`、`claude-md/**`、`vendor/snippets/**`、`specs/truth/**`）寫到 aixbdd 的 skill 名、步驟順序或產物檔名時。

上游 `Waterball-Software-Academy/aixbdd` 的 `main` 最新版是 skill 名、步驟順序、產物檔名與 skill 行為的唯一準則。

1. 上游退役或改名一支 skill 時，clade **每一個**源檔對它的引用 MUST 在同一次改動內改成上游現名與現行步驟，不是只改被發現的那一處。
2. fork `clade/main` 相對上游 `main` 在 `.agents/skills/**` 的 diff MUST 為 0。clade 需要而上游沒有的行為，MUST 落在 clade 自有層：registry `mirror.cladeOwnedFiles`（例：各 owner 目錄的 `specformula.md` overlay）、`mirror.cladeOwnedSkillDirs`（`work-route`）、本檔或 `specs/truth/work-lifecycle.md`。**NEVER** 在 fork 上改寫上游 skill 檔，也 **NEVER** 在 rebase 到新上游時保留與上游衝突的改寫。
3. 上游 README 與 skill 契約（`SKILL.md`、`rules/**`）對同一步驟寫法不同時，**NEVER** 自己挑一邊改 clade：維持 clade 現狀，把兩邊逐字列給 Charles 裁決。
4. bump pin 或 re-mirror 之前 MUST 跑 `node scripts/audit-upstream-submodules.ts --only aixbdd`，讀「skill 層上游為準」一節：「fork patch 改到的上游 skill 檔」與「clade 源檔仍引用退役名」兩個數非 0 時，先逐檔處置（撤回、搬到 clade 自有層、或改引用）再 bump。

| 藉口（逐字，出自 fork commit 訊息） | 現實 |
| --- | --- |
| 「Repos that do not match keep the upstream NNN behaviour unchanged, so this is upstream-compatible.」 | 條件式 patch 仍是改寫上游 skill 檔：上游下一次改同一段時它就是衝突來源，而上游不知道 fork 存在。predicate 守住的是非 clade repo，不是與上游的相容 |

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | informational — 不觸發任何東西（audit 永遠 exit 0；兩個「應為 0」的數由讀者照本節處置） |
| 消費端 | 做 aixbdd pin bump、re-mirror 或 fork 改動的 agent；`node scripts/audit-upstream-submodules.ts` 的「skill 層上游為準」一節 |
| 載入路徑 | consumer：本節（paths-gated 於 `specs/plans/**`、`specs/truth/**`、`.agents/constitution/**`）。clade home 不自動載入 `rules/core/`，案發時刻的載入點是該 audit 輸出裡指向本節的標題行（`version-upgrade` 的 `skills-mode.md` § S.1 逐字指名該 audit） |

## Reference signal（不 block）

宣告即須完整覆蓋，既有 consumer 一律回補——truth 是空的 consumer 照 cookbook `vendor/snippets/aixbdd/baseline-reverse.md` 從程式碼逆向建基準線（B3）。宣告與實況的判準只住在 `scripts/lib/capability-truth-coverage.ts`，兩個入口共用：

| 入口 | 量什麼 | 擋不擋 |
| --- | --- | --- |
| `node scripts/audit-registry-reality.ts --consumer <id>` R8 | truth root（`specs/truth/work-lifecycle.md`＋`owners.md`）、`techstack.md`、`isa.yml`（只限 specformula）、`specs/truth/features/**/*.feature` | error；publish gate 以 ratchet 擋新增 |
| `node scripts/audit-specformula-adoption.ts` 的 aixbdd 表 | 上列＋`dsl.md`（刻意只進本表、不進 R8：缺它 work-route 仍能開 plan）、constitution、鏡射 skill、W／NNN plan 數 | 參考訊號，exit 0 |

缺 `work-lifecycle.md` 報 `capability-lifecycle-migration`：`specs/truth/work-lifecycle.md` 是 lifecycle-repo marker（一存在，gate 擋新 TD、`docs/tech-debt.md` 凍結、舊 TD 只經 `specs/truth/legacy-ids.json` 解析），scaffold **NEVER** 代放——照 `vendor/snippets/consumer-lifecycle/README.md` 先把舊 TD 逐筆處置進 `legacy-ids.json`（或搬進 plan § Open work），再由 consumer 放 marker。已是 lifecycle repo 只缺 `owners.md` 報 `capability-truth-root`，用 `node ~/offline/clade/scripts/scaffold-consumer-truth.ts --consumer-path <consumer> --apply`（或 `audit-registry-reality --consumer <id> --scaffold`）補齊：只建缺檔、NEVER 覆寫、冪等。manifest 讀不出來（兩份衝突／schema 不過）報 `capability-manifest-unreadable`，fail closed。`techstack.md`、`isa.yml`、feature 由各自 owner skill 產出，NEVER 捏造。truth 歸 consumer，不走 propagate。

上游為準的訊號（skill 層偏離、mirror 與上游的差）不在上表：看 `node scripts/audit-upstream-submodules.ts --only aixbdd`（見上節）。上表量的是 consumer 的 truth／plan／鏡射 skill 覆蓋，**NEVER** 讀成 skill 層是否以上游為準。
