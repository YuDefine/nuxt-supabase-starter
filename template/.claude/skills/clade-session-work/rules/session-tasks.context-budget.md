---
description: Session context 預算的判定層——席位→profile 表（唯一定義處：壓縮 profile 重置前落盤、交棒 profile 到 hard tier 收工）、主判準的可觀察 predicate 表、重置前與越過 soft tier 後的出口，以及量測口徑紀律。觸發錨是 `session-context-budget-warn.sh` 在越過門檻的當下印出的提示，那段輸出直接指過來；Iron Law 一句留在 [[session-tasks]] 常駐層
paths: ['tasks/**', 'HANDOFF.md']
---
<!-- Clade native rule; source: rules/core/session-tasks.context-budget.md; edit canonical source -->

<!-- clade-targets: claude,agents -->

# Session context 預算的判定層

> [[session-tasks]] § Session context 預算 的下推層，由 `session-context-budget-warn.sh` 越過門檻時的提示指過來。

### 席位 → profile（唯一定義處）

因 context 大小觸發的重置，用什麼方式由 session **實際生效的視窗**（`CLAUDE_CODE_AUTO_COMPACT_WINDOW`）查下表決定。其他條文（[[session-tasks]]、[[session-tasks.operations]]、handoff skill、coordinator 判準、brief 樣板）都引用本表，**NEVER** 另寫一份席位或數字。

| 生效視窗 | profile | 席位 | 重置方式與義務 |
| --- | --- | --- | --- |
| `300000` | 壓縮 | 互動主線、交棒接手、派工 child、runner child、Fable 主線 | 約 267k 原地自動壓縮；約 235k 提示一次，在下一個自然斷點落盤（plan.md § 進度或 task 檔、WIP commit）然後續做。**NEVER** 因 context 大小交棒或送 relay-request。runner child 另有每輪新 process 這一層重置 |
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

### 交棒 profile 的兩級語義

兩級語義與 Iron Law 見 [[session-tasks]] § Session context 預算，只適用交棒 profile。補充：超過 hard tier 時，不可分割的單一驗證迴圈先跑完，不延伸成下一段。

### 重置前與越過 soft tier 後的出口

手上這件（含它的驗證）做完、仍有殘工時，出口依 profile 與身分分流。**NEVER** 停下等 user 處理，**NEVER** 把「要不要 relay」當題目問 user；真的要 user 拍板的題目寫進 brief 待決段隨棒交出。

| profile／身分 | 動作 |
| --- | --- |
| 壓縮 profile（任何身分） | 寫回 plan.md § 進度（沒有 plan 就寫 task 檔）並 commit，然後續做；壓縮原地發生。只有上表「換主題／糾正 ≥2 次／品質退化」才走下兩列的開新 session |
| 交棒 profile：主線（`CLADE_DISPATCH_ID` 空） | 自己交棒：1 件或彼此 serial 走 `/handoff relay`，N 件可平行走 `/handoff fanout`；沒有殘工就直接收工 |
| 交棒 profile：被派出的 child（`CLADE_DISPATCH_ID` 非空） | 回報主持、由主持指揮：判定表在 `handoff` skill `relay-steps.md` § 0（寫回 plan.md、commit＋push、`--complete relay-request --plan <plan.md>`；可自 relay 的例外見該表） |

**MUST 用該 profile 定義的量測口徑判門檻**：累計用量、當前 context 佔用與壓縮後剩餘量不是同一個值。缺少 profile 或量測能力時，明列該缺口，使用上述可觀察 predicate 與 harness 的實際限制；**NEVER** 借另一個 runtime 的門檻、hook payload 或 model 名稱宣稱已適用、未超標或取得豁免。

Runner 與顧問身分須由該 runtime 的真實入口／session 證據判定，工作內容像顧問或無人值守不構成身分證據。
