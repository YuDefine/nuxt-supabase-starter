---
name: work-route
description: Use when the user wants to start or continue project work (new requirement, bug report, or refactor) without picking workflow skills. NOT for fleet readiness or registry drift queries (clade-onboard).
license: MIT
metadata: {"author":"clade","version":"1.0","clade":{"permission_tier":"action"}}
---

<!-- clade-skill-scope: both -->

<!-- clade-workflow-bundles: ["spec-by-example","technical-research","ui-plan","api-plan","data-plan","dsl-refine","gherkin-and-dsl","tasks","bdd","truth-delta","clarify-over-specs","specformula-config","specformula-api-spec","specformula-entity-spec","specformula-feature"] -->

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
| 已簽 presale 包（`presale.json` status=signed）＋ 新 repo | 同上一列走 clade-onboard → project-bootstrap（intake 由 presale 包預填）；回此入口後以 `flow plan open <slug> --seed-from <presale 目錄> --milestone M1` 開第一個 package，不從會議紀錄重寫 spec |
| 已簽 presale 包 ＋ 既有 consumer | 直接以 `flow plan open <slug> --seed-from <presale 目錄> --milestone <M-x>` 開 package；後續 Milestone 在前一個結案後才開。`contract-<M-x>.feature` NEVER 改寫或刪除，範圍變更回 presale 開修訂版 |
| clade 中央倉，registry role=source-of-truth | 依 work-lifecycle 處理；不對它跑排除 source-of-truth 的 consumer audit，也不製造 consumer manifest |
| 已 onboard 專案的新工作／續跑 | 檢查其實際 manifest 與所需 capability，定位本次 package |
| 純措辭／設定，不改行為、權限、資料或部署語意 | 依 repo 流程直接實作與驗證，免 package |
| bug 回報，出錯的是沒有 I/O 的純邏輯（計算、解析、格式化、邊界值） | 免 package：迴歸落 unit test，與修正同一個 commit；不在 `work_kind` 值域內 |
| bug 回報，出錯的行為已有 scenario | `--kind bug-covered`：NOOP delta 指向被違反的不變量＋迴歸錨點（先紅再修）；不發明新 truth |
| bug 回報，出錯的行為沒有 scenario（只有舊測試或沒有測試） | `--kind bug-uncovered`，進下方 workflow：ADD delta 把當下正確的行為寫成 truth 與 scenario，再修；該區舊測試在 Phase 3 吸收 |
| 分析發現缺陷要重構，行為不變 | `--kind refactor`，進下方 workflow：先確認（缺的以 ADD delta 補上）釘住現行行為的 scenario 且綠，再動結構；該區舊測試同一件工作吸收。行為要變就走「新增／修改／刪除既有行為」列 |
| hotfix | `flow plan open --hotfix` 先修：它帶一條「補迴歸 scenario（hotfix 先修）」open work，沒補完結不了案；補的時候以 `flow plan set-kind` 定為 `bug-covered` 或 `bug-uncovered`，不以一支 unit／e2e 迴歸測試結案 |
| 一次性工作（不改行為） | 遵守該次授權，不強套完整流程 |
| 新增／修改／刪除既有行為 | `--kind behavior`，進下方 workflow，完成已授權部分 |

宣告 aixbdd 的 consumer 裡，迴歸只有在受測單元沒有 I/O（純計算、解析、邊界值）時才落 unit test；帶 `clade-legacy-test` marker 的舊測試怎麼吸收、變紅時怎麼分岔，照 `clade-spec-workflow` skill 的 `rules/legacy-tests.md`，**每一次**進 bug、重構或 hotfix 列之前讀它。

所有路徑都檢查本步所需前提；不要求一次備齊未來步驟的輸出。使用者的「繼續／y」沿用已確認的範圍與決策，不重新訪談；未呈現過的 PM 驗收不因泛稱繼續而視為確認。

</decision_boundary>

<workflow>

## 0. worktree isolation gate（任何寫入之前）

先唯讀確認 cwd、`git rev-parse --git-dir`、工作項目既有 checkout／owner、`work_id` 與 `git status --porcelain`；dirty paths 依 repo 的 clade-managed 判準計數，包含 tracked 與 untracked。本 gate 也管 constitution 修補、免 package、調查證據與 package 骨架；下列第 1–3 節可先讀取與分類，但不能先寫檔再補隔離。

| 情境 | 隔離路由 |
| --- | --- |
| read-only：只讀取／分類／檢查，不改檔且不需隔離或結構化證據蒐集 | 留在目前環境，不呼叫 `wt`；仍查驗本步前提 |
| multi-file／write：會寫檔的實作或調查、預期兩個以上檔案（spec+checklist、source+test/docs），或需要隔離／結構化證據蒐集 | 先確認 `work_id`，再交 `wt` 建立／選定隔離環境，重驗後才交原下游 |
| dirty-main：共享 main 已有 >=2 個 clade-managed dirty files | 不可繼續在 main 寫入；交 `wt`／既有 worktree owner，先釐清本次 WIP 所有權；純唯讀檢查仍可繼續 |
| already-worktree：git-dir 含 `/worktrees/`，或本工作已有 implementation checkout | 確認該 checkout 的 work_id、範圍與 writer ownership 後沿用；**同一個切片**不巢狀呼叫 `wt`、不另開第二棵；owner 不明則交既有 worktree owner |
| parallel-slices：同一個 work_id 的 `tasks.md` 有 2 個以上**當下已解鎖、彼此無依賴**的 task，且 repo 的 github-flow 規約有 § Integration branch | 本工作的 checkout 升為 integration（branch `integration/<work-id>`），本 agent 是 coordinator；**每一個**平行切片各交 `wt` 開一棵，沿用同一個 work_id、不另鑄識別，開工前宣告路徑且與每一個其他活切片不相交。路徑相交的 task 併成同一個切片或序列化。切片併入、同步與紅燈處置依該規約，不在此複述 |
| publish-preparation：本次變更最後需 publish／propagate | 修改與驗證先走 worktree，交付後由發布 owner 承接 main-bound 階段 |
| main-bound：僅執行設計上綁定 main 的 publish／propagate | 交 `clade-publish` 的 main-bound owner，不呼叫 `wt`；仍須通過發布的 clean／ownership gate，不能豁免 dirty-main 禁寫條件 |

**判定優先序**（不是 first-match）：先分唯讀與寫入，再看是否已有本工作擁有的 worktree（有就沿用）。parallel-slices 的「不另開第二棵」只約束單一切片，**NEVER** 讀成同一個 work_id 只能有一棵 worktree。dirty-main 門檻只限制共享 main 的寫入，不阻止唯讀檢查。dirty paths 歸屬或 writer ownership 不明時先交既有 owner 釐清，未確認前不寫。main-bound 例外只適用發布操作本身，要改 source／test／文件仍先走隔離。

**work_id-before-worktree**：先沿用本工作的 `work_id`；沒有就交 work identity owner 依 repo 契約取得／鑄造後才建立或進入工作樹（`wt-helper add` 可在同一流程鑄造並綁定）。不把 slug 當 work_id，不為取得識別在 dirty main 先寫 package，沒有可用流程就列阻塞；同一工作不另鑄第二個識別。身分歸屬依序判定：

| 情境 | 做法 |
| --- | --- |
| 被主持者派出（`CLADE_DISPATCH_ID` 非空） | 沿用 dispatch 帶來的 `CLADE_WORK_ID`；本 pane 範圍外的**新** work 不自己鑄，回報主持者由它開 plan 並派 |
| 已有本工作的 work id，要拆子工作 | 子工作 `flow open <slug>`：ambient `CLADE_WORK_ID` 有 dispatch record 或本 worktree claim 佐證時自動 `work.link` 到 ambient；確定不是子工作才加 `--no-parent` |
| `flow open` 印「未自動掛到 ambient」 | ambient 沒佐證（多半是別張卡殘留的 shell）。確認真是子工作才照它印的 `flow link … --parent …` 手動掛；**NEVER** 為了掛上去改 export 別的 id |

transport 交 `wt` 建立隔離環境，並在樹內續跑原下游候選；交棒攜帶 work_id、package、允許路徑、writer owner 與續跑位置。**NEVER** 用 stash、reset 或 commit 藏掉未知 WIP；帶入既有 WIP 要先確認所有權與授權，交 `wt` owner 依 baseline guard 處理。

## 1. 定位同一工作與規則

讀取本次需求、適用 `specs/truth/**`、既有 package 的 spec／plan／research／tasks 及證據；只續跑本次相關且未完成的工作。

**提出方案或鑄新 work id 之前**，MUST 列出**每一份** active plan（lifecycle repo：`flow plan list`），對**每一份** Scope 與本次需求重疊的 plan 讀完 `plan.md` 的 Scope、Decisions 與 Open work。重疊就續跑那一份；部分重疊時，新 plan 的 Scope MUST 有分工表寫明哪一塊歸哪個 work id（`flow plan open` 的 entry gate 只擋同 slug）。

已有 `plan.md` frontmatter 同時含 `work_id:` 與 `truth_baseline:` 時，沿用 `specs/plans/<work-id>/`。新工作：repo 根有 `specs/truth/work-lifecycle.md` 時 MUST 先 `flow plan open` 鑄 `W-…`，並以 `--kind` 記錄上表判定的工作種類；值域、各種類的必要產物與迴歸錨點寫法見本 skill 根的 `rules/工作種類與必要產物.md`，**每一次**開 package 或改判之前讀它。manifest 宣告 `aixbdd`／`specformula` 卻沒有該檔，是要先修的前提而不是降級理由：照第 3 節第 3 步處理 truth root，再 `flow plan open`；**NEVER** 靜默改鑄 `NNN-<slug>`。只有兩側都沒宣告、且使用者沒有要採用 lifecycle 的 consumer 才鑄 `NNN-<slug>`。不為補前提、轉 owner 或重試另開 package。

**Notion ticket 詢問（鑄新 work id 之前）**：確定是新需求／新 bug 要鑄 work id 時，先在 consumer 根跑 `node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .`（script 只在 clade 中央倉，consumer 沒有這份；不寫死任何 id）。由上而下取第一個成立的列：

| 可觀察 predicate | 處理 |
| --- | --- |
| 續跑既有 package、已從 Notion 票認領（`--origin notion:`），或免 package 工作 | 不問，照上段 |
| `configured: false`（未宣告 `notion.hub`） | 不問，照上段鑄 work id |
| resolve 失敗（非 0 exit、輸出不是 JSON） | 不問；照上段鑄 work id，並告知使用者 hub 解析失敗與錯誤原文，不靜默略過 |
| `configured: true`、`hub.ticketType` 為 null | 不問（使用者明說要開票也一樣）；照上段鑄 work id，並告知該 hub 的 `類型` 選項未驗證、`file` 會拒寫 |
| `configured: true`，使用者已在需求裡明說要／不要開票 | 不問，直接照下方「要」／「不要」處理 |
| `configured: true`，以上都不成立 | 鑄 work id **之前**問一次「要不要為這件工作建 Notion ticket」，附選項（推薦排第一）。`hub.delivery` 為 null（board-only hub）時問題 MUST 點明「不建票，客戶在 Notion 上看不到這件工作」 |

「要」→ 照 `notion-hub` skill Phase 4（工程師建票）跑 `node ~/offline/clade/vendor/scripts/notion-sync.ts file --title "<客戶看得懂的一句話>" --kind bug|feature --slug <slug>`，由它建票並鑄 work id（照做它印的 `export CLADE_WORK_ID=…`）；lifecycle repo 接著以 `flow plan open <slug> --work-id <該 id>` 開 package，**NEVER** 另鑄第二個 id。「不要」→ 照上段原流程鑄 work id。這是鑄 id 時的一次性詢問，不是同步步驟；之後的 ticket 推進照 `notion-work-coupling` 跟隨 flow。

本次要調整 project constitution，或下一 owner 必讀的 constitution 缺失時，載入本 skill 的 `rules/.constitution/SKILL.md` 及其要求的資源，由該 owner 做最小增量處理。已授權工作中的可確定前提直接補齊；會改需求、權限或高影響規則時，只問具體缺口。

| 藉口（逐字，出自既有 plan 的 Decisions） | 現實 |
| --- | --- |
| 「constitution 未存在，本輪不改 constitution artifact」 | 缺失就是本段的觸發條件，不是豁免——照這句跳過，每個 session 會各留一份互不相同、未落地的 constitution。既有 plan 這樣寫 **NEVER** 構成前例：由 owner 建最小版、獨立落地，再續跑原工作 |

內部 `rules/.constitution/**` 是執行契約；專案 `.agents/constitution/**` 是治理 artifact。兩者不能互相替代。按當前 checkout 驗證 project artifact，不拿另一 worktree 的未提交檔冒充存在，也不把內部契約複製成 project constitution。

## 2. 載入真正可用的 owner

MUST 先讀本 skill 根的 `rules/上游覆寫-lifecycle落點與doctor.md`，才載入下游 owner——**每一次**、下表每一列都一樣，含公開入口 specify、clarify、system-analysis、implement 與 bundle 內的內部流程。上游 owner 的原文是 pin 的上游版本，clade 的 lifecycle 落點（L）與 canonical doctor（D）調整只寫在那份檔：命中它寫明的判準就照覆寫列執行，沒命中照 owner 原文。**NEVER** 只讀 owner 的 `SKILL.md` 就開始寫 artifact——上游原文會建 `NNN-*` package、`truth-delta.md`、覆寫 lifecycle `plan.md`，也不跑 doctor。

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
| specformula-config、specformula-api-spec、specformula-entity-spec、specformula-feature | `rules/.workflow/<owner>/SKILL.md`；只由下方 § SpecFormula 契約載入點 的宿主 owner 載入，不單獨成步 |
| specify、clarify、system-analysis、implement | 當前 runtime 的公開入口與必要 resources；Claude 端這四支模型呼叫不了，照下方 § explicit 入口由本 agent 代打 |

### explicit 入口由本 agent 代打

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

本 skill 根：Claude `.claude/skills/work-route/`、Codex `.agents/skills/work-route/`。內部流程由 `clade-workflow-bundles` 隨本 skill 投影到 `.` 開頭的目錄（避免被 runtime 列成公開 skill），多數搜尋工具預設不掃，所以一律照上表明確路徑讀取，**NEVER** 用搜尋結果為空判定不存在。只讀本步入口及它明列的必讀資源。

**clade overlay 只從本表走得到。** 三個 owner 各有一份 clade-owned 的 `specformula.md`，上游 `SKILL.md` 不會提到：bundle 內的 `rules/.workflow/bdd/specformula.md`、`rules/.workflow/technical-research/specformula.md`，以及公開入口 implement 目錄的 `implement/specformula.md`（與 implement 的 `SKILL.md` 同目錄）。載入這三個 owner 時 MUST 一併讀它，依該檔的適用條件套用（bdd 那份在後端 BDD techstack 是 SpecFormula 時不手寫 step definition；technical-research 那份給三題必問的 fleet 預設；implement 那份把 Phase 3 的三個 marker 改落在規格檔）。**NEVER** 因上游入口沒列就略過。

### SpecFormula 契約載入點

`specs/truth/techstack.md` 的後端 BDD techstack 是 SpecFormula 時，下列四支上游契約由表中的宿主 owner 在該步載入，與宿主契約一起執行；techstack 未採 SpecFormula 就一支都不載。它們規定 SpecFormula 的檔案形狀，不取代宿主的 truth 所有權、PM gate 或驗收。**NEVER** 用「宿主 `SKILL.md` 沒提到」略過；也 **NEVER** 在宿主以外的步驟自行改寫它們管的檔。

| 契約 | 宿主 owner 與時機 | 本步必須做到 |
| --- | --- | --- |
| `specformula-config`（含 `nuxt.md`、`java.md`、`custom-instruction.md`） | technical-research 選定 SpecFormula 時；implement 的 Setup task 安裝與接線時；implement `[BDD-ALIGN]` 或 bdd `red` 要新增 `isa.yml` 指令時 | 選定時確認 `isa.yml` 表達得了本專案的資料源與 `db_type`，限制寫進 techstack。Nuxt 專案的安裝照 clade-owned 的 `rules/.workflow/specformula-config/nuxt.md` 與 `~/offline/clade/vendor/snippets/specformula/` cookbook。新句型先加 `instructions[]` regex，框架做不到的才用 `custom`（`custom-instruction.md`） |
| `specformula-api-spec` | api-plan Phase 3 寫 truth OpenAPI 時 | `isa.yml` 的 `config.api.resource_path` 讀的就是 api-plan 維護的 `specs/truth/contracts/**`，不另存一份 OpenAPI。每個 operation 的 `summary` 全域唯一，用業務語言的「動詞＋名詞」。`isa.yml` 指向另一份 OpenAPI 時不手動同步兩份，交 tasks 排一條把 `isa.yml` 改指 truth 的 task |
| `specformula-entity-spec` | data-plan 本輪有 table／field 語意變更時，同一輪 | 更新 `isa.yml` 各 `config.data.source[].resource_path` 下的 `entity_to_table_mapping.yml`（業務語言實體名）與 DDL（語法依該 source 的 `db_type`），與 DBML 同一語意；落在 `specs/truth/data/**` 內時一併列進本輪 delta。只改 API 的工作不捏造 entity |
| `specformula-feature`（含各指令檔） | implement `[BDD-ALIGN]` 寫 `dsl.yml` 的 `isa_steps` 時；bdd `red` 補 `.feature` 的 `Example` 時 | 先讀專案 `isa.yml` 的 `instructions[].format`，指令句與符號（`>`、`<`、`$`、`&`）照該契約與各指令檔；`dsl.yml` 的轉換規則仍照 `implement/specformula.md` |

下游契約提到 `/tasks`、`/bdd`、`/truth-delta` 等流程時回本表解析，由 orchestrator 載入契約執行，不把缺少 slash UI 當成能力缺失。上游契約的 `.agents/skills/<owner>/scripts/...` 前綴換成當前 runtime 的 `work-route/rules/.workflow/<owner>/`，保留腳本與參數。尤其 gherkin-and-dsl Phase 6 必須實際執行 `uv run <work-route-root>/rules/.workflow/gherkin-and-dsl/scripts/audit_feature_dsl_topology.py --root <features-root>`；其中 `<work-route-root>` 是上表所列當前 runtime 的 skill 根，`<features-root>` 是 **truth 的介面根**（含 `dsl.md` 的那一層，例如 `specs/truth/features/cli`）。plan package 的 `features/acceptance/` 沒有 `dsl.md`，拿它當 root 每一個 step 都會報找不到 DSL row——plan 端 acceptance 的對應檢查是 `flow plan readiness <work-id>`（dry-run 無 undefined／ambiguous step）。保留稽核輸出，失敗交回該 owner，不因路徑搬移而略過。

**每一次**交棒給 owner（含 owner 內要外派的工作）之前，MUST 讀本 skill 根的 `owner-routing.md`，照該 owner 那一列決定由誰執行（主線或 routing table 的哪一列、首跳 model／effort）。表上沒有的 model 或 effort 不自行挑；列的硬禁令與派不派判準照 routing table。

每次交棒都記錄 runtime、owner、執行者（`owner-routing.md` 的列與首跳）、實際載入路徑、必要 artifact 與同步證據。用既有 projector 的唯讀規劃／check 核對目前 checkout；檔案存在、dry-run exit 0、另一 runtime 的成功都不單獨證明已同步。

## 3. 前提修復與接續迴圈

1. 從所選 owner 的實際契約解析輸入（project artifact 按專案根、internal resources 按 owner 目錄），逐檔檢查。尚待該 owner 產出的檔案不是輸入前提。
2. 缺投影或安裝：用 repo 的固定版本來源與既有投影／安裝 owner 補齊後重驗；不手改 generated projection、不從網路追最新版、不把 pinned internal flow 裝成公開 skill。
3. 缺 project artifact：載入該 artifact owner 並執行其流程；constitution 走第 1 節，techstack 走 technical-research。truth root 分兩種：缺 `specs/truth/work-lifecycle.md` 是 **lifecycle 遷移**，不是補檔——`specs/truth/work-lifecycle.md` 是 lifecycle-repo marker（一存在，gate 擋新 TD、`docs/tech-debt.md` 凍結、舊 TD 只經 `specs/truth/legacy-ids.json` 解析），scaffold **NEVER** 代放；照 `~/offline/clade/vendor/snippets/consumer-lifecycle/README.md` 先把舊 TD 逐筆處置進 `legacy-ids.json`（或搬進 plan § Open work），處置量大或要 user 拍板時先停下回報，NEVER 為了開 W- plan 跳過。已是 lifecycle repo 只缺 `owners.md` 時，owner 是 `node ~/offline/clade/scripts/scaffold-consumer-truth.ts --consumer-path <consumer 根> --apply`：範本源固定、只建缺檔、NEVER 覆寫，建好的檔隨本次工作 commit。它印出的其餘缺口（`techstack.md`、`isa.yml`、acceptance feature）照本步交各自 owner。既有 artifact 已回答的事項不重問，不代替 owner 捏造答案。
4. 前提通過後，實際執行候選 owner，查驗產出，重新判定下一步並繼續；「知道下一支是誰」不是本輪完成條件。
5. 同一修復方式沒有新證據時不重複重試；修復 owner 循環、來源不可取得、必要工具無法使用、權限不足或需要外部狀態改變時，保留已做工作與原始錯誤，回報具體缺口及解除條件。仍可獨立完成的工作繼續。

若必須問使用者，只問需求取捨、必要環境資訊、權限邊界或具體驗收確認；不問「要不要載入下一支 skill／修入口／繼續查」。不得宣稱未通過的 gate 已完成。

### 品質 gate 失敗：先分可修復與不可修復

`vp check`、typecheck、lint、測試等品質 gate 失敗時，先讀錯誤全文再分類；exit code 非 0 本身不是停手理由。判準全文在 verify-gate-chain 規約（clade 源檔 `rules/core/verify-gate-chain.md`，consumer 投影 Claude `.claude/rules/verify-gate-chain.md`、Codex `.agents/skills/clade-verification/rules/verify-gate-chain.md`）§ 可修復的 gate 失敗不是停手理由；該規約 path-gated，沒載入時照這個路徑直接讀。

| 可觀察 predicate | 處理 |
| --- | --- |
| 可修復：錯誤具名到檔（與行），修法在本次 scope 內（格式、lint、型別、import、root cause 明確的 test assertion；root cause 不明的 test 紅燈照 verify-gate-chain 的不確定 error 處理） | 讀錯誤、就地修、從 L0 重跑整輪 gate chain，全綠後續接原工作；test assertion 紅修受測實作，**NEVER** 放寬或改寫斷言求綠 |
| `pnpm exec vp check` 只報格式 | 修前看 `git status --porcelain`，只對本次擁有的路徑跑 `pnpm exec vp check --fix <owned-paths>`（或 `pnpm exec vp fmt --ignore-path .oxfmtignore <owned-files>`；裸打 `vp fmt` 必帶 `--ignore-path`），修後看 `git diff` 確認變動只落在擁有的路徑，再從 L0 重跑整輪 gate chain。**NEVER** 跑不帶路徑的全 repo `--fix`，也 **NEVER** 還原別人改過的檔；報錯的檔不歸你就回報持有者 |
| spec 矛盾（verify-gate-chain 的 specification error） | 立刻退回規格層 owner（`ROLLBACK:<artifact>`），不在執行層改「做什麼」 |
| 不可修復：環境經 self-fix 仍不可解、權限不足、需人拍板、修法在 scope 外、同一 error 連續 2 輪不收斂 | 照上方第 5 點停手並回報具體 blocker |

**NEVER** 把可修復的 gate 失敗當成收工、`--complete failed` 或 `--complete blocked` 的理由；brief 或 relay prompt 寫「gate 失敗即停」時，也只指不可修復那一類。

## 4. 依產物推進 aixbdd

依序處理第一個尚未完成的項目。每一步均先過第 2–3 節；不跳過 constitution、PM confirmation 或 task 解鎖。

| Package 狀態 | 執行 owner 與完成後接續 |
| --- | --- |
| 尚無 spec／新行為 | specify 產 spec 與 requirements checklist |
| spec 有高影響未決需求 | clarify-over-specs／clarify，只問未決事項 |
| acceptance 未完成 | spec-by-example 產本 package 的 `features/acceptance/**` |
| 本次有 UI，缺需求確認用的設計、雛形或 review | impeccable 依 spec 產出可供 PM 確認的證據：`shape` 釐清需求 → new-work 方向回合（impeccable 自己開本機決策頁）；方向說不清用 `live`／`generate` 出變體；不確定下一步跑無參數 `impeccable` 照它的推薦。此時不呼叫需要 system-analysis 的 ui-plan |
| techstack、測試策略或系統端未決 | technical-research；既有 techstack 明載且本次未改判即沿用，不為三題格式重問 |
| Gherkin 與適用 UI 證據已完成，PM 未確認 | 展示可審查結果與具體確認問題，等待使用者；未確認不進 system-analysis |
| PM 已確認、分析未完成 | system-analysis，按需承接 api-plan／data-plan |
| PM 已確認、分析完成，本次 truth delta 尚未形成 | 依分析 handoff 由 truth-delta 或適用 truth owner 產出本輪 delta |
| 本次有 UI，分析與 delta 已就緒、缺工程 UI plan | ui-plan 讀取分析與 delta 產出 ui/**；與 PM 已確認設計對照，若改使用者可見行為則回需求／PM 確認 |
| DSL／Gherkin 與本次 delta 尚未對齊 | dsl-refine／gherkin-and-dsl 與適用 truth owner |
| 缺 tasks 規劃，或既有規劃與確認後的 delta 不一致 | tasks 產出／更新規劃；既有 task 尚未實作不代表缺規劃 |
| 規劃已對齊，存在已解鎖且尚未完成的 task | implement，依 task 類別承接 bdd 等 owner；完成後進驗證。2 個以上已解鎖且彼此無依賴 → 先過第 0 節 parallel-slices |
| task 的改動含 entry point（`server/{api,routes,middleware,tasks}/`、pages、Next route handler），尚未跑 evlog map gate | 標 task done 之前跑 `node .github/actions/evlog-map-gate/local.ts`（app 根在子目錄的 repo 用該子目錄下那一支）：它照 CI workflow 的 mode／cwd 跑 CI 同一道 gate，未 commit 與 untracked 的檔也算本次觸及；CI 沒有這道 gate 時它回報跳過。紅燈照輸出逐一補插樁、重跑到綠才標 done |
| UI task 實作完成、尚未走修改閉環 | 依 `proactive-skills.design-checkpoint` 跑閉環：Stage 1 `critique`＋`audit` → Stage 2 依 P0–P3 問題族跑專科指令、`polish` 關閉快照 → Stage 3 沉澱（`document`／`extract`／`ignore.md`），寫 `design-review.md`；三階段完成才標 task done |
| 尚有未完成 task，但全被阻塞 | 依相依性處理前置 task／具體 blocker，不重建 tasks 或宣稱完成 |
| tasks 完成 | 第 5 節驗證、適用 review、commit／交付流程；檢查未結工作 |

採 SpecFormula 時，上表 technical-research、api-plan、data-plan、implement、bdd 這幾步另依第 2 節 § SpecFormula 契約載入點 載入對應契約；那張表沒列到的步驟不載。

Lifecycle package 的 `plan.md` 由 lifecycle owner 持有；分析寫 `system-analysis.md`，delta 意圖寫 `plan.md` 的 `## Truth delta`，不新建 `truth-delta.md`（逐 owner 的覆寫見 `rules/上游覆寫-lifecycle落點與doctor.md`）。對話裡的上游 NNN 範例不改變此落點。工作種類決定的省略（例如 `bug-covered` 不要 `spec.md` 與 acceptance feature）由 gate 依 `work_kind` 判定，不寫 Decisions；其餘省略 UI／research／OpenAPI 等 artifact 時，在 `plan.md` 的 `## Decisions` 寫工作特定理由；尚未完成不叫省略。

## 5. 銜接 SpecFormula 與交付

Aixbdd 決定需求、Gherkin、DSL、設計與 tasks；SpecFormula 執行已對齊的驗收。按當前 project techstack、capability 與 SpecFormula 契約選擇已安裝 runner；只用 aixbdd 且已明確採另一 BDD runner 的專案沿用其決策，不無條件改堆疊。

對採 SpecFormula 的專案，先由 technical-research／dsl-refine／implement／bdd 等 owner 依第 2 節 § SpecFormula 契約載入點 把必要 DSL、ISA、adapter 與驗收命令接到真實被測入口，再執行該命令。步驟未定義、缺 runner 或 acceptance_command 時，由對應 owner 修復後重驗；不拿語法 parser、空 step 或永遠成功的替身充當驗收。

有 UI 變更的工作交付前做沉澱檢查：本輪動到 token 來源（`app.config.ts` 的 `ui`、CSS `:root` 變數、Tailwind theme）或建立新元件慣例時，DESIGN.md 已由 `document` 更新，或 `design-review.md` 寫明「本輪無 design system 變更」；受影響畫面的每個 P0／P1 都有可核對的 polish／明確 close、重跑 critique 歸零或使用者確認的 ignore 證據。commit 0-B.1 對已採用 impeccable 的 repo 會唯讀核對；`closed: true` 或指紋不同本身不會放行。

本工作動過 entry point 時，commit 與 `gh pr ready` 之前各以整份 branch diff 再跑一次 `node .github/actions/evlog-map-gate/local.ts`；push 時 pre-push 也跑同一支。三者與 CI 同一份判定，差別只在掃的是本機的樹（未 commit 的改動也會被掃到）。

分別呈現「Gherkin 可解析」「步驟已綁定／readiness 通過」「實際案例通過」「人工驗收已確認」。只有對應證據存在才能宣稱該項完成；失敗回到 owner 修復，scope 變更回需求 owner。不得為變綠自行降低已確認的驗收標準。

走 PR 的 repo：本工作對 `main` 的 PR 在第一個 commit 之後以 **draft** 開出，實作期間維持 draft；`tasks.md` 全部完成、本機驗證通過後才 `gh pr ready` **一次**。開發期的測試訊號來自來源 worktree（repo 宣告的 affected／targeted 測試），**NEVER** 為了看 CI 綠燈提前轉 ready，也 **NEVER** 用反覆 push 到 ready PR 當測試迴圈——repo 的 github-flow 規約若規定 draft 不跑重測試，提前轉 ready 就是把整輪重測試的成本搬回每一次 push。

執行已授權的交付與收尾流程；缺外部部署／付費／對外寫入授權時先完成可審查結果再詢問。使用者只要求分析、規格或 review 時，在指定成果完成處停止，不擴張成實作／部署。

</workflow>

<output_contract>

工作中用短訊息說明已完成的成果、當前步驟與下一個會解除的不確定性。正常接續不以五段路由報告結束回合，也不請使用者再次輸入 skill 名稱。

需要保留交接／阻塞診斷時記錄以下五欄到同 package，使用者只看影響結果的摘要：

1. `需求類型:` `work_kind` 的值（`behavior`／`bug-uncovered`／`bug-covered`／`refactor`，hotfix 另註）、續跑、research 或狀態查詢。
2. `package 或免 package:` 唯一 work id 與路徑，或免 package 的具體理由。
3. `下一支 skill:` 具名 owner、實際公開／內部入口，以及已執行或待解除的動作。
4. `缺少的前提:` runtime、路徑／決策、已嘗試的修復與結果；全部查驗通過才填無。
5. `UI checkpoint:` 需要／不需要／沿用證據及原因。

最終回覆交代產出、驗證與實際剩餘工作。需要人類判斷時展示具體選擇與理由；沒有必要的人類決策就繼續已授權工作，不用「下一步要不要……」轉嫁協調責任。

</output_contract>

<default_follow_through_policy>

預設持續推進到使用者要求的成果完成，或到必要的人類決策／不可自行解除的外部阻塞。流程 owner 的 artifact 權責、runtime 指定 executor、PM／UI gate、權限與驗收證據保持有效；統一入口不代表略過下游契約。收到新訊息先吸收修正，再沿同一工作接續。

</default_follow_through_policy>
