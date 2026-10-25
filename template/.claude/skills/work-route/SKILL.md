---
name: work-route
description: Use when the user wants to start or continue project work (new requirement, bug report, or refactor) without picking workflow skills. NOT for fleet readiness or registry drift queries (clade-onboard).
license: MIT
metadata: {"author":"clade","version":"1.0","clade":{"permission_tier":"action"}}
---


<!-- clade-workflow-bundles: ["spec-by-example","technical-research","ui-plan","api-plan","data-plan","dsl-refine","gherkin-and-dsl","tasks","bdd","truth-delta","clarify-over-specs","specformula-config","specformula-api-spec","specformula-entity-spec","specformula-feature"] -->

# work-route（統一工作入口）

使用者描述想完成的工作即可。本 skill 持有從需求到驗收、交付的接續責任：定位同一工作、載入正確 owner 的契約、執行已授權步驟、處理可修復前提，再依結果繼續；每份 artifact 仍由指定 owner 產出，不由 router 冒充 owner 或跳過驗收，也不是只列出「下一支 skill」的導航頁。預設持續推進到使用者要求的成果完成，或到必要的人類決策／不可自行解除的外部阻塞；收到新訊息先吸收修正，再沿同一工作接續。

每一步只讀該步命中的判準檔（路徑相對本 skill 根：Claude `.claude/skills/work-route/`、Pi `.agents/skills/work-route/`），**NEVER** 一次讀完全部 `rules/`。

# SOP

## Phase 1 -- 分類需求

1. READ 讀取本次需求與使用者已確認的範圍（「繼續／y」沿用已確認範圍，不重新訪談；只查本步所需前提，不要求一次備齊未來步驟的輸出）。對話中有使用者已確認的 interview 訪談交棒摘要時，它就是已確認範圍，其「分流事實」直接用於 step 2，不重問。
2. THINK 先讀取 `rules/需求分流判準.md`，依 Q 表（必要時再判 K 表）取本次的列 id（含 `work_kind`、免 package、presale seed、hotfix）；判不出唯一一列，或使用者表示要先討論需求時，照 step 4。
3. THINK 屬宣告 aixbdd 的 consumer 的 K1–K5（hotfix、bug、重構）時，**每一次**先讀取 `clade-spec-workflow` skill 的 `rules/legacy-tests.md`，再決定迴歸落點與舊測試吸收。
4. THINK 需求待談清楚時，依下表決定由誰補齊分流事實，**NEVER** 自行猜列：

評估：first-match；以上皆非 → T*

| id | predicate | 動作 |
| --- | --- | --- |
| T1 | 不能向使用者詢問（判法見表下） | 不進 interview；缺的分流事實寫成待拍板題交呼叫端通道，本件停在此處 |
| T2 | 本件已有確認版訪談交棒摘要，且 step 2 判不出唯一一列 | **NEVER** 再進 interview；自己補齊後回 step 2（補法見表下） |
| T3 | 以上皆非（使用者在本 session、可詢問） | 讀取同層 `../interview/SKILL.md` 執行，帶入已知事實；以確認版摘要回 step 2 |
| T* | 判定本身失敗（讀不到 env、工具錯誤） | 照 T1 |

T1 判法：env `CLADE_DISPATCH_ID` 非空（coordinator 派出的 child），或判不出在不在場。呼叫端通道：dispatch child 走 `--complete blocked` 並附題目；沒有具名通道（例如一次性 `--print`）就把題目寫進本次最終回覆。T2 補法：摘要標「待讀程式碼」的事實自己讀程式碼判；仍缺只有使用者知道的事，照 Phase 5 step 6 只問一題。補完 step 2 仍判不出唯一一列（例如分流表兩列同時命中）時，**NEVER** 再回本步：以 QnX 列出候選列請使用者選一列，依選擇續行並把理由記入 § Decisions。

## Phase 2 -- 通過 worktree 隔離 gate

1. READ 接下來會寫任何檔（含 constitution 修補、免 package、調查證據、package 骨架）時，唯讀確認 cwd、`git rev-parse --git-dir`、既有 checkout／owner、`work_id` 與 `git status --porcelain`。
2. THINK 先讀取 `rules/worktree隔離路由判準.md`，依 I 表 first-match 決定留在原地、交 `wt`、沿用既有 worktree、升 integration 或交 `clade-publish`，再逐條套 IC 附加約束，並確認 work id 的來源。
3. DELEGATE 需要隔離時讀當前 runtime 的 `wt/SKILL.md`，以 Form 3 交棒並攜帶 work_id、package、允許路徑、writer owner 與續跑位置。

## Phase 3 -- 定位同一工作並開 package

1. READ 讀取本次需求、適用 `specs/truth/**`、既有 package 的 spec／plan／research／tasks 及證據；lifecycle repo 先 `flow plan list`，對**每一份** Scope 與本次需求重疊的 plan 讀完 `plan.md` 的 Scope、Decisions 與 Open work，提出方案或鑄新 work id 之前不可略過；重疊就續跑那一份，部分重疊時新 plan 的 Scope MUST 有分工表寫明哪一塊歸哪個 work id（`flow plan open` 的 entry gate 只擋同 slug）。
2. THINK 先讀取 `rules/工作種類與必要產物.md`，決定續跑或以 `flow plan open --kind <值>` 鑄 `W-…`；manifest 宣告 aixbdd／specformula 卻缺 `work-lifecycle.md` 時，讀取 `clade-onboard` skill 的 `rules/交棒前truth-root處置判準.md` 處置，不降級改鑄 `NNN-<slug>`。
3. THINK 鑄新 work id 之前先讀取 `rules/鑄workid前Notion詢問判準.md`，DELEGATE `notion-hub.ts resolve` 後依第一個成立的列決定問不問、怎麼開票。
4. THINK 若 project constitution 缺失或本次要調整，先讀取 `rules/constitution觸發判準.md`，再載入 `rules/.constitution/SKILL.md` 做最小增量。
5. WRITE 本次有確認版訪談交棒摘要時：免 package → 摘要不落檔，未決題回報使用者；只有「bug 且出錯的是沒有 I/O 的純邏輯」列把驗收例子逐條寫成迴歸 unit test 案例，其他免 package 列不另寫測試；續跑既有 package → 只把新決策追加進 § Decisions；新開 package → 依下表寫入 `plan.md`：

| 摘要節 | 落點 |
| --- | --- |
| 目標、使用者與情境、現況與痛點、驗收例子原文 | § Purpose |
| 範圍、限制 | § Scope |
| 已確認決策、我的推測、分流事實表、T2 結論 | § Decisions |
| 未決題（扣掉已解的） | § Open work |

驗收例子另交寫 scenario 的 owner：behavior／bug-uncovered 交 spec-by-example，bug-covered／refactor 交 dsl-refine 寫錨點。

## Phase 4 -- 載入 owner

1. READ 每一次載入下游 owner 之前先讀取 `rules/上游覆寫-lifecycle落點與doctor.md`。
2. THINK 先讀取 `rules/owner載入位置判準.md`，定位 owner 的公開入口或 `rules/.workflow/<owner>/SKILL.md`；載入 bdd、technical-research、implement 時一併讀 `rules/.workflow/bdd/specformula.md`、`rules/.workflow/technical-research/specformula.md`、`implement/specformula.md`；輪到 specify、clarify、system-analysis、implement 時照該檔 Rule 2 由本 agent 代打派出。
3. THINK 若 `specs/truth/techstack.md` 的後端 BDD techstack 是 SpecFormula，先讀取 `rules/SpecFormula契約載入判準.md`，只在宿主 owner 的指定時機載入四支契約。
4. THINK 每一次交棒前先讀取 `rules/owner-routing.md`，照該 owner 那一列決定執行者與首跳 model／effort，並記錄 runtime、owner、執行者、實際載入路徑、必要 artifact 與同步證據（用既有 projector 的唯讀規劃／check 核對目前 checkout；檔案存在、dry-run exit 0、另一 runtime 的成功都不單獨證明已同步）。

## Phase 5 -- 修前提並執行 owner

1. READ 從所選 owner 的實際契約解析輸入（project artifact 按專案根、internal resources 按 owner 目錄），逐檔檢查；尚待該 owner 產出的檔不算前提。
2. DELEGATE 缺投影或安裝時，用 repo 的固定版本來源與既有投影／安裝 owner 補齊後重驗（不手改 generated projection、不從網路追最新版、不把 pinned internal flow 裝成公開 skill）；缺 project artifact 時載入該 artifact 的 owner 執行（constitution 走 Phase 3 step 4，techstack 走 technical-research，truth root 走 Phase 3 step 2）；既有 artifact 已回答的事項不重問、不代替 owner 捏造答案。
3. DELEGATE 前提通過後實際執行 owner，查驗產出，重新判定下一步並繼續；「知道下一支是誰」不是本輪完成條件。
4. THINK 品質 gate（`vp check`、typecheck、lint、測試）失敗時先讀取 `rules/品質gate失敗分流判準.md`，可修復就修並從 L0 重跑；不可修復或同一修法沒有新證據時，保留已做工作與原始錯誤，回報具體缺口與解除條件。
5. THINK 調查、驗收需要 production 資料當證據（含要修 production 資料）時，先讀取 `rules/production證據判準.md`，只走 `prod-sql`。
6. WRITE 必須問使用者時，只問需求取捨、必要環境資訊、權限邊界或具體驗收確認；不問「要不要載入下一支 skill／修入口／繼續查」，也不宣稱未通過的 gate 已完成。
7. DELEGATE 使用者在 package 進行中要停下來討論需求或範圍時，讀取同層 `../interview/SKILL.md`，帶本 package 的 work id 執行；回來後把確認版摘要的新決策追加進該 `plan.md` § Decisions，受影響的 artifact 交回原 owner 修訂，再從原續跑位置繼續。

## Phase 6 -- 依產物推進 aixbdd

1. THINK 先讀取 `rules/依產物推進判準.md`，取第一個尚未完成的 package 狀態列，交對應 owner（每一次回 Phase 4–5，不跳過 constitution、PM confirmation 或 task 解鎖）。
2. WRITE 省略非 `work_kind` 決定的 artifact（UI／research／OpenAPI 等）時，在 `plan.md` 的 `## Decisions` 寫工作特定理由；尚未完成不叫省略。

## Phase 7 -- 驗收與交付

1. THINK 先讀取 `rules/驗收與交付判準.md`，分別呈現「Gherkin 可解析」「步驟已綁定／readiness 通過」「實際案例通過」「人工驗收已確認」，交付給人校對或驗收的改版附 before／after 對照入口或前後截圖，做 UI 沉澱檢查與 evlog map gate。
2. DELEGATE 走 PR 的 repo 在第一個 commit 後以 draft 開 PR，實作期間維持 draft；`tasks.md` 全部完成且本機驗證通過後才 `gh pr ready` **一次**。開發期的測試訊號來自來源 worktree（repo 宣告的 affected／targeted 測試），**NEVER** 為了看 CI 綠燈提前轉 ready，也 **NEVER** 用反覆 push 到 ready PR 當測試迴圈。
3. WRITE 需要保留交接或阻塞診斷時，先讀取 `templates/work-route交接紀錄.md` 與 `templates/work-route交接紀錄.example.md`，寫入同 package；最終回覆交代產出、驗證與實際剩餘工作。
