---
description: ad-hoc 工作的追蹤載體、唯讀與指定產物邊界、共享單檔紀律、session context 預算門檻
when: "開始非瑣碎的 ad-hoc 工作（第一個 tool call 前）、交棒、收工，或 context 預算提示出現時"
---
<!-- Clade native rule; source: rules/core/session-tasks.md; edit canonical source -->
<!-- clade-targets: claude,agents -->
<!-- clade-adapters: claude -->

# Session Tasks

每一個 ad-hoc 工作先依當次授權選擇載體：

| 可觀察的任務範圍 | 追蹤與交付 |
| --- | --- |
| 明示唯讀、禁止寫檔，或只要求對話交付盤點／計畫 | 直接在對話交付，不建立 task 檔或修改 repository／spine |
| 只允許寫指定計畫／報告文件 | 只在該文件追蹤，不另建 tasks 檔、不擴成實作或提交 |
| 已授權本機修改、當次可完成的 ad-hoc 工作 | 提交說明保存意圖與驗證即可；需要同 session 清單時才建 `tasks/<YYYY-MM-DD-HHMM>-<slug>.md` |
| 需要跨 session 接續、決策或遷移 | **MUST** `node vendor/scripts/flow/flow.ts plan open <slug> --title '…'`，載體是 `specs/plans/<work-id>/work.md`（舊 package：`plan.md`，寫入端切換前 `flow plan open` 仍鑄這種） |

任務後續取得實作授權時重新套用上表；唯讀交付不代替實作追蹤。拆得開的工作 **NEVER** 用共享單檔（例如 `tasks/todo.md`／`tasks/notes.md`）；一 session 一檔，只編輯自己的 task 檔。`HANDOFF.md`、`ROADMAP.md`，以及未遷移 consumer 的 `docs/tech-debt.md` 是本質共享登記簿，改它們前依 [[session-tasks.concurrent-writers]] § 共享單檔的寫入紀律（lifecycle repo 的 `docs/tech-debt.md` 與 clade `docs/pitfalls/**` 已停寫）。

命中實作列時，原生進度工具只呈現進度，不能替代 task 檔。session 結束時每個未完項 MUST 升級或刪除，二擇一；模板、升級路徑、work id、Herdr transport、收工契約與 pane 判定在 [[session-tasks.operations]]，首次碰 `tasks/**` 或寫收工訊息前 MUST Read。

## Session context 預算

先依 target adapter 確認實際 runtime、launcher、量測口徑，再依生效視窗查已核准 profile（席位→profile 表只在下方 § 席位 → profile）；不可借另一 runtime 的門檻或 model 名稱宣稱豁免。**壓縮 profile 的義務是重置前落盤**：提示出現就在下一個自然斷點寫回進度並 commit，然後續做，NEVER 因 context 大小交棒。**交棒 profile 的 Iron Law：適用 hard tier 是收工線；soft tier 是限制新大工作段。** 超過 soft tier 後 MUST 不開新的 tasks 檔、多檔重構、新實作 phase 或尚未載入的 skill；手上驗收與小 item 仍可完成；手上這件做完仍有殘工時 MUST 依身分主動交棒（下方 § 重置前與越過 soft tier 後的出口），**NEVER** 停下等 user 處理。超過 hard tier 後 MUST 保存狀態並按 [[session-tasks.operations]] 收工；交棒 profile 下壓縮不重設 hard-tier 義務。

交棒 profile 的兩級語義與 Iron Law 以本節為準，只適用交棒 profile；不可分割的單一驗證迴圈超過 hard tier 時先跑完，不延伸成下一段。runtime 的原生命令、hook 與 marker 由 adapter 承載。`session-context-budget-warn.sh` 越過門檻時印的提示指向本節；hard-tier 提示出現時依具名時機主動 Read [[session-tasks.operations]]。

### 席位 → profile（唯一定義處）

因 context 大小觸發的重置，用什麼方式由 session **實際生效的視窗**（`CLAUDE_CODE_AUTO_COMPACT_WINDOW`）查下表決定。其他條文（[[session-tasks]]、[[session-tasks.operations]]、handoff skill、coordinator 判準、brief 樣板）都引用本表，**NEVER** 另寫一份席位或數字。

| 生效視窗 | profile | 席位 | 重置方式與義務 |
| --- | --- | --- | --- |
| `300000` | 壓縮 | 互動主線、交棒接手、派工 child、runner child、Fable 主線 | 約 267k 原地自動壓縮；約 235k 提示一次，在下一個自然斷點落盤（`work.md`（舊 package：`plan.md`） § 進度或 task 檔、WIP commit）然後續做。**NEVER** 因 context 大小交棒或送 relay-request。runner child 另有每輪新 process 這一層重置 |
| `600000` | 交棒 | 主持席（另設 `idleCompaction:false`） | 約 300k 交棒（coordinator 判準 Rule 1）；soft 300k、hard 500k、之後每 +100k 收工提示；壓縮只是保險 |
| 其他值或未設 | 交棒，hook 附警告 | — | 同交棒 profile |

- 觸發點＝視窗 − 33k，判定比的是「目前 context＋待送訊息」。提示線與觸發點之間只有 32k 緩衝，單一大工具結果或貼上可以從提示線下直接越過觸發點、沒有提示就壓縮；保險是 PreCompact 落盤（`pre-compact-snapshot.sh`），**NEVER** 把提示當成壓縮前一定會出現的訊號
- 壓縮 profile 的提示區間（約 235k 到觸發點）內 **NEVER** 開始 publish、0-A 鏈或 relay 這類原子程序；已在跑的做到可切點
- PreCompact hook **NEVER** exit 2：視窗由 env 設定時，被擋的壓縮走 reactive skip，不會跳 breaker 熄火，而是每次模型呼叫重叫 hook，context 一路長到 blocking limit。hook MUST 冪等且快
- env 存在時 `/autocompact` 直接拒絕、不寫檔；改視窗只改 settings 的 env，主持席由 launcher 的 `--settings` 帶 600000
- 換主題、換所有權、品質退化、同一問題糾正 ≥2 次，**不分 profile** 一律開新 session（下表）

依生效視窗選已核准 profile 不算放寬門檻；門檻數字只能依已核准政策調整，**NEVER** 自行以 env／flag 改數字。現行政策與依據見 `docs/decisions/2026-10-22-autocompact-300k-coordinator-600k.md`。

### 主判準是可觀察 predicate

| 可觀察 predicate | 動作 |
| --- | --- |
| 換到不相關的任務、repo 或主題 | 先保存本工作狀態，再用該 runtime 支援且當次獲授權的 fresh-context 或 session transport |
| 同一問題已糾正 ≥2 次 | 把已驗證教訓與未決問題整理成可接手的狀態，使用可用的 fresh-context 機制重新開始該問題 |
| phase 完成的自然斷點，尚未超過適用 hard tier | 保存狀態並使用實際可用的 context 壓縮／checkpoint；原生壓縮不等於工作已完成 |
| 忘記早前指令、重複錯誤或品質退化 | 保存目前授權、成果與未完項，開新 session（主線 relay、child relay-request）；壓縮不能修好品質退化 |
| 深在同一個複雜問題，history 仍有價值，且未命中適用 hard tier | 繼續推進，不以其他 runtime 的數值切斷工作 |

### 重置前與越過 soft tier 後的出口

手上這件（含它的驗證）做完、仍有殘工時，出口依 profile 與身分分流。**NEVER** 停下等 user 處理，**NEVER** 把「要不要 relay」當題目問 user；真的要 user 拍板的題目寫進 brief 待決段隨棒交出。

| profile／身分 | 動作 |
| --- | --- |
| 壓縮 profile（任何身分） | 寫回 `work.md`（舊 package：`plan.md`） § 進度（沒有 plan 就寫 task 檔）並 commit，然後續做；壓縮原地發生。只有上表「換主題／糾正 ≥2 次／品質退化」才走下兩列的開新 session |
| 交棒 profile：主線（`CLADE_DISPATCH_ID` 空） | 自己交棒：1 件或彼此 serial 走 `/handoff relay`，N 件可平行走 `/handoff fanout`；沒有殘工就直接收工 |
| 交棒 profile：被派出的 child（`CLADE_DISPATCH_ID` 非空） | 回報主持、由主持指揮：判定表在 `handoff` skill `relay接力判準.md` § 0（寫回 lifecycle 檔、commit＋push、`--complete relay-request --plan <lifecycle 檔路徑>`；可自 relay 的例外見該表） |

**MUST 用該 profile 定義的量測口徑判門檻**：累計用量、當前 context 佔用與壓縮後剩餘量不是同一個值。缺少 profile 或量測能力時，明列該缺口，使用上述可觀察 predicate 與 harness 的實際限制；**NEVER** 借另一個 runtime 的門檻、hook payload 或 model 名稱宣稱已適用、未超標或取得豁免。

Runner 與顧問身分須由該 runtime 的真實入口／session 證據判定，工作內容像顧問或無人值守不構成身分證據。

## 並行爭用

檔案層的 dirty／mtime／claim 只能回答「有人寫」，不能回答「對方會不會停」。任何 commit、merge-back、stash 或 publish 遇到其他 actor 時，MUST Read [[session-tasks.concurrent-writers]] 完成四層探測（首步是 `node vendor/scripts/flow/flow.ts who --json`），再依該檔 § 共享單檔的寫入紀律行動；**`agent_status: idle` NEVER 等於「對方收手了」。** 未知時保留 WIP，不 stash、不代 commit、不搶 publish。

## 真相層與回報

task 檔只承載當前 session 的授權、進度、證據與未完項，而且只存在這台機器：**每一次**改 task 檔的進度、卡點或下一步，同一步 MUST 送 `node ~/offline/clade/vendor/scripts/flow/flow.ts work checkpoint [<work-id>] --step '…' [--blocked-on '…'] [--next '…']`，別台用 `flow where <work-id>` 查、死 session 的殘留用 `flow orphans` 查；卡在外部 PR 時 `--blocked-on` 寫 `pr:<owner>/<repo>#<N>`、`--next` 寫解除後那一步，PR 終局時 `flow orphans` 與 SessionStart 會列出來喚醒。長期契約在 `specs/truth/`（或既有唯一機器 owner）。跨 session 工作接續同一份 plan。`HANDOFF.md` 是從 flow + active plan 生成的 view。follow-up 依 [[follow-up-register]]。**「等」是 [[session-tasks.concurrent-writers]] § 分類後直接行動 表中的一種處置，NEVER 是「判不出來」的同義詞。** Herdr 不可用時，**降級掉的是「對方是誰」，NEVER 是「所以可以 escalate 了」**；本規則不把短期 task 註記冒充長期登記，也不因 task 檔存在就宣稱工作完成。
