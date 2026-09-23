---
name: work-route
description: Use when the user wants to start or continue project work without choosing workflow skills. Pure fleet readiness or registry drift queries belong to clade-onboard.
license: MIT
metadata: {"author":"clade","version":"1.0","clade":{"permission_tier":"action"}}
---

<!-- clade-skill-scope: both -->

<!-- clade-workflow-bundles: ["spec-by-example","technical-research","ui-plan","api-plan","data-plan","dsl-refine","gherkin-and-dsl","tasks","bdd","truth-delta","clarify-over-specs"] -->

# work-route（統一工作入口）

<role>

使用者描述想完成的工作即可。本 skill 持有從需求到驗收、交付的接續責任：定位同一工作、載入正確 owner 的契約、執行已授權步驟、處理可修復前提，再依結果繼續。不是只列出「下一支 skill」就結束的導航頁。

每份 artifact 仍由指定 owner 產出；呼叫 owner 是同一 agent 載入其完整契約後執行，或依 runtime routing 交給必要 executor，不要求使用者輸入另一個 slash command。先通過 owner 的前提，不由 router 冒充 owner 或跳過驗收。

</role>

<decision_boundary>

| 當前需求 | 處理 |
| --- | --- |
| 只問 onboard 狀態、readiness、registry drift | 交 clade-onboard 完成查詢，不建立 package |
| 純討論、評估方案，未要求落地 | 在對話中研究與說明，不寫 repo／flow |
| 新建／採用專案 | 執行 clade-onboard 判定，依結果承接 project-bootstrap；保留其 intake、外部副作用授權與完成條件，完成後回此入口 |
| clade 中央倉，registry role=source-of-truth | 依 work-lifecycle 處理；不對它跑排除 source-of-truth 的 consumer audit，也不製造 consumer manifest |
| 已 onboard 專案的新工作／續跑 | 檢查其實際 manifest 與所需 capability，定位本次 package |
| 純措辭／設定，不改行為、權限、資料或部署語意 | 依 repo 流程直接實作與驗證，免 package |
| 可重現的既有 scenario regression | 依 bug 流程恢復既有 truth；缺 scenario 或改行為則回 specify |
| hotfix／一次性工作 | 遵守該次授權與 regression 要求，不強套完整流程 |
| 新增／修改／刪除既有行為 | 進下方 workflow，完成已授權部分 |

所有路徑都檢查本步所需前提；不要求一次備齊未來步驟的輸出。使用者的「繼續／y」沿用已確認的範圍與決策，不重新訪談；未呈現過的 PM 驗收不因泛稱繼續而視為確認。

</decision_boundary>

<workflow>

## 0. worktree isolation gate（任何寫入之前）

先唯讀確認 cwd、`git rev-parse --git-dir`、工作項目既有 checkout／owner、`work_id` 與 `git status --porcelain`；dirty paths 依 repo 的 clade-managed 判準計數，包含 tracked 與 untracked。本 gate 也管 constitution 修補、免 package、調查證據與 package 骨架；下列第 1–3 節可先讀取與分類，但不能先寫檔再補隔離。

| 情境 | 隔離路由 |
| --- | --- |
| read-only：只讀取／分類／檢查，不改檔且不需隔離或結構化證據蒐集 | 留在目前環境，不呼叫 `wt`；仍查驗 本步前提查驗 |
| multi-file／write：會寫檔的實作或調查、預期兩個以上檔案（spec+checklist、source+test/docs），或需要隔離／結構化證據蒐集 | 先確認 `work_id`，再交 `wt` 建立／選定隔離環境，重驗後才交原下游 |
| dirty-main：共享 main 已有 >=2 個 clade-managed dirty files | 不可繼續在 main 寫入；交 `wt`／既有 worktree owner，先釐清本次 WIP 所有權；純唯讀檢查仍可繼續 |
| already-worktree：git-dir 含 `/worktrees/`，或本工作已有 implementation checkout | 確認該 checkout 的 work_id、範圍與 writer ownership 後沿用；**同一個切片**不巢狀呼叫 `wt`、不另開第二棵；owner 不明則交既有 worktree owner |
| parallel-slices：同一個 work_id 的 `tasks.md` 有 2 個以上**當下已解鎖、彼此無依賴**的 task，且 repo 的 github-flow 規約有 § Integration branch | 本工作的 checkout 升為 integration（branch `integration/<work-id>`），本 agent 是 coordinator；**每一個**平行切片各交 `wt` 開一棵，沿用同一個 work_id、不另鑄識別，開工前宣告路徑且與每一個其他活切片不相交。路徑相交的 task 併成同一個切片或序列化。切片併入、同步與紅燈處置依該規約，不在此複述 |
| publish-preparation：本次變更最後需 publish／propagate | 修改與驗證先走 worktree，交付後由發布 owner 承接 main-bound 階段 |
| main-bound：僅執行設計上綁定 main 的 publish／propagate | 交 `clade-publish` 的 main-bound owner，不呼叫 `wt`；仍須通過發布的 clean／ownership gate，不能豁免 dirty-main 禁寫條件 |

**判定優先序**：上表不是 first-match。先區分唯讀與寫入，再確認是否已有本工作擁有的 worktree；multi-file／write 在 already-worktree 中直接沿用，不重建。parallel-slices 命中時，「不另開第二棵」只約束單一切片，**NEVER** 讀成同一個 work_id 只能有一棵 worktree——那會把可平行的 task 全部壓回序列。dirty-main 的 >=2 門檻是共享 main 的 fail-closed 寫入限制，不是所有 checkout 的 dirty 上限，也不阻止純唯讀檢查。無法確認 dirty paths 的 managed 歸屬或 writer ownership 時，先交既有 owner 釐清，未確認前不得寫入。main-bound 例外僅適用發布操作本身；若仍要修改 source、test 或文件，該準備工作仍先走隔離流程。

**work_id-before-worktree**：先解析並沿用本工作的 `work_id`；沒有時交 work identity owner，依 repo 契約取得／鑄造識別後才建立或進入工作樹。若 `wt-helper add` 支援在建立前鑄造並綁定識別，可由 `wt` owner 在同一流程完成；不能把 slug 當 work_id，也不能為取得識別在 dirty main 先寫 package。需要寫入的 identity／package 初始化由該 owner 的隔離流程承接；若無可用流程，列阻塞，不繞過 gate。同一工作不得另鑄第二個識別。

實際 transport 讀取當前 runtime 的 `wt/SKILL.md`，依其 baseline guard、既有 checkout 與 main-bound 例外執行；可用 Form 3 `/wt <slug>: /<downstream> <args>` 保留原候選。交棒攜帶 work_id、package、允許路徑、writer owner 與續跑位置。**NEVER** 用 stash、reset 或 commit 藏掉未知 WIP；需帶入既有 WIP 時先確認所有權與明確授權，交 `wt` owner 依 baseline guard 處理，不由 work-route 搬檔。

## 1. 定位同一工作與規則

讀取本次需求、適用 `specs/truth/**`、既有 package 的 spec／plan／research／tasks 及證據；只續跑本次相關且未完成的工作。

**提出方案或鑄新 work id 之前**，MUST 先列出**每一份** active plan（lifecycle repo：`flow plan list`），對**每一份** Scope 與本次需求路徑或主題重疊的 plan 讀完 `plan.md` 的 Scope、Decisions 與 Open work。重疊的工作續跑那一份；只有部分重疊時，新 plan 的 Scope MUST 有一張分工表寫明哪一塊歸哪個 work id。`flow plan open` 的 entry gate 只擋得住同 slug，擋不住同主題不同 slug——既有 plan 裡已拍板的決策與實測，不讀就會被重新提一次。

已有 `plan.md` frontmatter 同時含 `work_id:` 與 `truth_baseline:` 時，沿用 `specs/plans/<work-id>/`。新工作：repo 根有 `specs/truth/work-lifecycle.md` 時 MUST 先 `flow plan open` 鑄 `W-…`；沒有該檔的 consumer 才鑄 `NNN-<slug>`。不為補前提、轉 owner 或重試另開 package。

本次要調整 project constitution，或下一 owner 必讀的 constitution 缺失時，載入本 skill 的 `rules/.constitution/SKILL.md` 及其要求的資源，由該 owner 做最小增量處理。已授權工作中的可確定前提直接補齊；會改需求、權限或高影響規則時，只問具體缺口。

| 藉口（逐字，出自既有 plan 的 Decisions） | 現實 |
| --- | --- |
| 「constitution 未存在，本輪不改 constitution artifact」 | 缺失就是本段的觸發條件，不是豁免。同型註記在三個 session 各出現一次，各留下一份互不相同的未提交 constitution，沒有一份落地。既有 plan 這樣寫 **NEVER** 構成前例：由 owner 建最小版、獨立落地，再續跑原工作 |

內部 `rules/.constitution/**` 是執行契約；專案 `.agents/constitution/**` 是治理 artifact。兩者不能互相替代。按當前 checkout 驗證 project artifact，不拿另一 worktree 的未提交檔冒充存在，也不把內部契約複製成 project constitution。

## 2. 載入真正可用的 owner

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
| specify、clarify、system-analysis、implement | 當前 runtime 的公開入口與必要 resources |

Claude、Codex、Cursor 的本 skill 根分別為 `.claude/skills/work-route/`、`.agents/skills/work-route/`、`.cursor/skills/work-route/`。內部流程由 `clade-workflow-bundles` 隨本 skill 投影，完整保留其相對 rules／templates，不另加公開 skill。內部契約放在 `.` 開頭的目錄，是為了不讓會遞迴掃 `SKILL.md` 的 runtime 把它們列成公開 skill；多數檔案搜尋工具預設不掃這類目錄，所以一律照上表的明確路徑讀取，**NEVER** 用搜尋結果為空判定內部流程不存在。只按需讀本步入口及它明列的必讀資源，不一次載入全部流程。

**clade overlay 只從本表走得到。** bdd 與 technical-research 的 bundle 目錄各有一份 clade-owned 的 `specformula.md`（`rules/.workflow/bdd/specformula.md`、`rules/.workflow/technical-research/specformula.md`），上游 `SKILL.md` 一個字都不會提到它們。載入這兩個 owner 時 MUST 一併讀同目錄的 `specformula.md`，再依該檔自己寫的適用條件決定是否套用：bdd 那份在 `techstack.md` 的後端 BDD techstack 是 SpecFormula 時覆蓋 step definition 的落點（不手寫 step definition），technical-research 那份給 clade consumer 三題必問的 fleet 預設。**NEVER** 因上游入口沒列就略過——照上游假設手寫 step definition，正是 bdd 那份 overlay 要擋的事。

下游契約內提到 `/tasks`、`/bdd`、`/truth-delta` 等流程時，也回本表解析並接續，不要求它們有獨立公開入口。這項工作已授權的內部流程由 orchestrator 載入契約執行；不能把缺少 slash UI 當成能力缺失。

內部流程的可執行資源也以實際 owner 根解析。上游契約中的 `.agents/skills/<owner>/scripts/...` 是原安裝位置；此 bundle 下須將該前綴換成當前 runtime 的 `work-route/rules/.workflow/<owner>/`，保留腳本與參數，不另外建立頂層 skill。尤其 gherkin-and-dsl Phase 6 必須實際執行 `uv run <work-route-root>/rules/.workflow/gherkin-and-dsl/scripts/audit_feature_dsl_topology.py --root <features-root>`；其中 `<work-route-root>` 是上表所列當前 runtime 的 skill 根，`<features-root>` 是 **truth 的介面根**（含 `dsl.md` 的那一層，例如 `specs/truth/features/cli`）。plan package 的 `features/acceptance/` 沒有 `dsl.md`，拿它當 root 每一個 step 都會報找不到 DSL row——plan 端 acceptance 的對應檢查是 `flow plan readiness <work-id>`（dry-run 無 undefined／ambiguous step）。保留稽核輸出，失敗交回該 owner，不因路徑搬移而略過。

每次交棒都記錄 runtime、owner、實際載入路徑、必要 artifact 與同步證據。用既有 projector 的唯讀規劃／check 核對目前 checkout；檔案存在、dry-run exit 0、另一 runtime 的成功都不單獨證明已同步。

## 3. 前提修復與接續迴圈

1. 從所選 owner 的實際契約解析輸入。按專案根解析 project artifact，按 owner 目錄解析 internal resources，逐檔檢查存在、可讀與適用性。尚待 owner 產出的檔案不是其輸入前提。
2. 缺投影或安裝：在目前授權範圍內，使用 repo 的固定版本來源、既有投影／安裝 owner 及支援的 CLI 補齊後重驗。保留本工作與使用者 WIP；不手改 generated projection、不從網路追最新版本、不把 pinned internal flow 臨時安裝成公開 skill。
3. 缺 project artifact：載入該 artifact owner 並執行其流程；constitution 走第 1 節，techstack 走 technical-research。既有 artifact 已回答的事項不重問，不代替 owner 捏造答案。
4. 前提通過後，實際執行候選 owner，查驗產出，重新判定下一步並繼續；「知道下一支是誰」不是本輪完成條件。
5. 同一修復方式沒有新證據時不重複重試；修復 owner 循環、來源不可取得、必要工具無法使用、權限不足或需要外部狀態改變時，保留已做工作與原始錯誤，回報具體缺口及解除條件。仍可獨立完成的工作繼續。

若必須問使用者，只問需求取捨、必要環境資訊、權限邊界或具體驗收確認；不問「要不要載入下一支 skill／修入口／繼續查」。不得宣稱未通過的 gate 已完成。

## 4. 依產物推進 aixbdd

依序處理第一個尚未完成的項目。每一步均先過第 2–3 節；不跳過 constitution、PM confirmation 或 task 解鎖。

| Package 狀態 | 執行 owner 與完成後接續 |
| --- | --- |
| 尚無 spec／新行為 | specify 產 spec 與 requirements checklist |
| spec 有高影響未決需求 | clarify-over-specs／clarify，只問未決事項 |
| acceptance 未完成 | spec-by-example 產本 package 的 `features/acceptance/**` |
| 本次有 UI，缺需求確認用的設計、雛形或 review | 適用 design／impeccable／review owner 依 spec 產出可供 PM 確認的證據；此時不呼叫需要 system-analysis 的 ui-plan |
| techstack、測試策略或系統端未決 | technical-research；既有 techstack 明載且本次未改判即沿用，不為三題格式重問 |
| Gherkin 與適用 UI 證據已完成，PM 未確認 | 展示可審查結果與具體確認問題，等待使用者；未確認不進 system-analysis |
| PM 已確認、分析未完成 | system-analysis，按需承接 api-plan／data-plan |
| PM 已確認、分析完成，本次 truth delta 尚未形成 | 依分析 handoff 由 truth-delta 或適用 truth owner 產出本輪 delta |
| 本次有 UI，分析與 delta 已就緒、缺工程 UI plan | ui-plan 讀取分析與 delta 產出 ui/**；與 PM 已確認設計對照，若改使用者可見行為則回需求／PM 確認 |
| DSL／Gherkin 與本次 delta 尚未對齊 | dsl-refine／gherkin-and-dsl 與適用 truth owner |
| 缺 tasks 規劃，或既有規劃與確認後的 delta 不一致 | tasks 產出／更新規劃；既有 task 尚未實作不代表缺規劃 |
| 規劃已對齊，存在已解鎖且尚未完成的 task | implement，依 task 類別承接 bdd 等 owner；完成後進驗證。2 個以上已解鎖且彼此無依賴 → 先過第 0 節 parallel-slices |
| 尚有未完成 task，但全被阻塞 | 依相依性處理前置 task／具體 blocker，不重建 tasks 或宣稱完成 |
| tasks 完成 | 第 5 節驗證、適用 review、commit／交付流程；檢查未結工作 |

Lifecycle package 的 `plan.md` 由 lifecycle owner 持有；分析寫 `system-analysis.md`，delta 意圖寫 `plan.md` 的 `## Truth delta`，不新建 `truth-delta.md`。對話裡的上游 NNN 範例不改變此落點。省略 UI／research／OpenAPI 等 artifact 時，在 `plan.md` 的 `## Decisions` 寫工作特定理由；尚未完成不叫省略。

## 5. 銜接 SpecFormula 與交付

Aixbdd 決定需求、Gherkin、DSL、設計與 tasks；SpecFormula 執行已對齊的驗收。按當前 project techstack、capability 與 SpecFormula 契約選擇已安裝 runner；只用 aixbdd 且已明確採另一 BDD runner 的專案沿用其決策，不無條件改堆疊。

對採 SpecFormula 的專案，先由 technical-research／dsl-refine／bdd 等 owner 把必要 DSL、ISA、adapter 與驗收命令接到真實被測入口，再執行該命令。步驟未定義、缺 runner 或 acceptance_command 時，由對應 owner 修復後重驗；不拿語法 parser、空 step 或永遠成功的替身充當驗收。

分別呈現「Gherkin 可解析」「步驟已綁定／readiness 通過」「實際案例通過」「人工驗收已確認」。只有對應證據存在才能宣稱該項完成；失敗回到 owner 修復，scope 變更回需求 owner。不得為變綠自行降低已確認的驗收標準。

走 PR 的 repo：本工作對 `main` 的 PR 在第一個 commit 之後以 **draft** 開出，實作期間維持 draft；`tasks.md` 全部完成、本機驗證通過後才 `gh pr ready` **一次**。開發期的測試訊號來自來源 worktree（repo 宣告的 affected／targeted 測試），**NEVER** 為了看 CI 綠燈提前轉 ready，也 **NEVER** 用反覆 push 到 ready PR 當測試迴圈——repo 的 github-flow 規約若規定 draft 不跑重測試，提前轉 ready 就是把整輪重測試的成本搬回每一次 push。

執行已授權的交付與收尾流程；缺外部部署／付費／對外寫入授權時先完成可審查結果再詢問。使用者只要求分析、規格或 review 時，在指定成果完成處停止，不擴張成實作／部署。

</workflow>

<output_contract>

工作中用短訊息說明已完成的成果、當前步驟與下一個會解除的不確定性。正常接續不以五段路由報告結束回合，也不請使用者再次輸入 skill 名稱。

需要保留交接／阻塞診斷時記錄以下五欄到同 package，使用者只看影響結果的摘要：

1. `需求類型:` 新需求／續跑／regression／hotfix／research／狀態查詢。
2. `package 或免 package:` 唯一 work id 與路徑，或免 package 的具體理由。
3. `下一支 skill:` 具名 owner、實際公開／內部入口，以及已執行或待解除的動作。
4. `缺少的前提:` runtime、路徑／決策、已嘗試的修復與結果；全部查驗通過才填無。
5. `UI checkpoint:` 需要／不需要／沿用證據及原因。

最終回覆交代產出、驗證與實際剩餘工作。需要人類判斷時展示具體選擇與理由；沒有必要的人類決策就繼續已授權工作，不用「下一步要不要……」轉嫁協調責任。

</output_contract>

<default_follow_through_policy>

預設持續推進到使用者要求的成果完成，或到必要的人類決策／不可自行解除的外部阻塞。流程 owner 的 artifact 權責、runtime 指定 executor、PM／UI gate、權限與驗收證據保持有效；統一入口不代表略過下游契約。收到新訊息先吸收修正，再沿同一工作接續。

</default_follow_through_policy>
