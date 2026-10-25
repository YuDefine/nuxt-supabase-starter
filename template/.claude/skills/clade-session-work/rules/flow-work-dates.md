---
description: 交期日期規約——對客戶或 Charles 給完成日、Milestone 日期、「趕得上嗎」、複核自報 ETA、寫 flow work eta 一律先走 /estimate-hours；日期分樂觀／可能／承諾三值，只有承諾值可以對外，對外前過四條 gate
---
<!-- Clade native rule; source: rules/core/flow-work-dates.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# 交期日期（Iron Law）

**任何日期判斷先跑 `/estimate-hours`，只有承諾值可以對外。** 「對 Charles 或客戶給完成日、Milestone 日期、回答趕得上嗎、複核別人自報的 ETA、寫 `flow work eta`」都算日期判斷，不論是新案報價還是既有專案。成因見 `docs/rule-rationale/estimate-hours.md` § 2026-10-22 重建。

| 情境 | MUST |
| --- | --- |
| 要給或要寫任何日期 | 先跑 `/estimate-hours`，拿樂觀、可能、承諾三值與硬下限；**NEVER** 憑印象或照趕工線自報的日期回答 |
| 寫 `flow work eta` | `--target` 寫可能值、`--basis estimate-hours`；只有自己估、沒跑 skill 的寫 `--basis agent-estimate`，**NEVER** 冒充 `estimate-hours` |
| 對內（Charles、coordinator、內部頁） | 三值都可以給，每個值都帶數據狀態（校準週／回退預設／未校準） |
| 對外（客戶、對外頁面、報價包、合約附件） | 只給承諾值，且先過「對外前的 gate」G1–G4 |

承諾值的定義（`/estimate-hours` 的 `rules/交期模型判準.md` 算）：P80 工期加 Milestone 層級緩衝，**NEVER** 攤到每個 task，且同時滿足兩個下限——

- 不早於硬下限：依賴鏈最早完成日＋合約固定觀察期
- 不早於把工作序列化的估算。只有在每一條平行線都綁了 owner 和容量時才可以低於它。Charles 的決策與驗收頻寬也算一條容量

## 對外前的 gate

評估：all-match（四條全過才可以對外）

| id | 條件 | 怎麼驗 |
| --- | --- | --- |
| G1 | 承諾日 ≥ 硬下限，且不早於序列化估算（每條平行線都綁了 owner 和容量時才可低於） | 對照 `/estimate-hours` 產出的硬下限欄與承諾值的序列化依據 |
| G2 | 依賴客戶的項目（客戶確認、現場動作、外部授權）只給條件式日期 | 寫成「<條件> 成立後 N 個工作天」，不寫成絕對日期；`/estimate-hours` C8 產出的「<條件> 於 <日> 前成立 → <日期>」是對內版，N＝條件成立日到該日期的工作天數 |
| G3 | 頁面或文件不含樂觀值與可能值 | 全文搜尋三值表、內部預測欄位 |
| G4 | Charles 逐份放行 | 有他對這一份的放行紀錄；`/estimate-hours` 產出帶「偏誤未修正，日期偏樂觀」註記時同樣適用 |

- 內部預估頁一律 private，**NEVER** 開「知道連結就能看」的分享：轉給客戶就等於把樂觀值當承諾。

## Rationalization table

| 想法 | 為什麼不成立 |
| --- | --- |
| 「只是內部估一下，不必跑 skill」 | 內部估的日期會被寫進 eta、轉給客戶；既有專案兩版重估都沒走 skill，都滑了數週（案例見 `docs/rule-rationale/estimate-hours.md`） |
| 「趕工線說可以，照它的日期回」 | 自報日期正是要複核的對象（`/estimate-hours` R 路徑），不是答案 |
| 「全部平行做就趕得上」 | 平行要每條線都有 owner 和容量；Charles 的頻寬是共用的，先被吃滿 |
| 「承諾日用目標日＋1 週」 | 承諾從可能值加緩衝、再核對下限推出來，不是從目標日推 |

## Red Flags

- 回覆裡出現單一日期，沒有三值或沒有數據狀態
- `flow work eta` 的 basis 不是 `estimate-hours`，日期卻被拿去對外
- 對外頁面出現「預計」「可能」「最快」
- 承諾日比同一天的可能值還早

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 要對 Charles 或客戶給日期、寫 `flow work eta`、複核自報 ETA。**informational**：沒有工具事件可攔，看板以 `basis` 分辨日期來源（`estimate-hours` 模型／agent 自估／人填） |
| 消費端 | 任何要給日期的 agent；`/estimate-hours`（三值與 gate 的計算）；看板與儀表板（basis 標籤） |
| 觸發點 | 本 rule（投影進 `clade-session-work`）＋ `/estimate-hours` description 的日期觸發詞 |
