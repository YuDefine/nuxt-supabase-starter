---
description: 宣告 aixbdd 的 consumer 裡，導入 BDD 之前留下的舊測試——凍結、只減不增、工作碰到就吸收；新測試與迴歸的落點
paths: ['**/*.test.*', '**/*.spec.*', 'vitest.config.*', 'playwright.config.*', 'specs/plans/**']
---
<!-- Clade native rule; source: rules/modules/capabilities/aixbdd/legacy-tests.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# 舊測試收編（aixbdd consumer）

> 盤點：`node scripts/legacy-tests.ts status`（`mark`／`unmark` 用法見檔頭；clade 源檔 `vendor/scripts/legacy-tests.ts`）
>
> 一次性分類 SOP：`~/offline/clade/vendor/snippets/legacy-tests/README.md`
>
> 流程層：[[aixbdd-workflow]]；bug 回報與重構的路由：work-route skill 的 decision boundary

**核心命題**：行為的唯一 owner 是 truth 與 BDD scenario。導入 aixbdd 之前寫下、沒有對應 truth 的測試是**舊測試**：凍結、只減不增，被工作碰到就**吸收**。

- **舊測試**：檔首 10 行內帶 `clade-legacy-test: frozen=<YYYY-MM-DD>` marker 的測試檔。
- **吸收**：把舊測試保護的行為交給 truth＋scenario，再刪除或重新分類該舊測試。

## 一次性分類（每個 consumer 做一次）

| 類 | 判準 | 處置 |
| --- | --- | --- |
| 死測試 | `skip`／`todo`、要重跑才綠、只斷言 mock 自己的回傳、測的功能已刪 | 刪 |
| 與 scenario 重疊 | 已有 scenario 驗同一個可觀察結果 | 刪 |
| 純邏輯不變量 | 受測單元沒有 I/O（HTTP、DB、檔案、瀏覽器）：計算、解析、格式化、邊界值 | 保留為一般 unit，不加 marker |
| 其餘行為測試 | 以上皆非 | 保留並 `legacy-tests.ts mark --frozen <分類完成日>` |

分完之後舊測試照常在 CI 裡跑，直到被吸收。

## MUST

1. **每一個**新增的行為保護都走 aixbdd：truth delta 加 scenario，迴歸落在 scenario。只有純邏輯不變量才新增 unit test，且它不帶 marker。
2. **每一次** bug 回報、或分析發現缺陷要重構，都經 work-route 進入工作（delta 類型與迴歸落點照它的路由列），不在 work-route 之外修完補一支 vitest 結案。
3. **每一件**工作的 Test Scope 碰到舊測試保護的行為時，Phase 3 一併處置那些舊測試：

   | 舊測試的狀況 | 處置 |
   | --- | --- |
   | 本輪 scenario 驗到同一個可觀察結果 | 刪除，記入 `[BDD-REMOVE]` |
   | 仍斷言 truth 已改寫的舊行為 | 刪除，記入 `[BDD-REMOVE]` |
   | 其實是純邏輯不變量 | `legacy-tests.ts unmark <path>`，轉為一般 unit |
   | 保護的行為本輪沒碰到 | 不動 |

4. 舊測試變紅時依 truth 分岔：truth 已明確改寫該行為 → 照上表吸收；truth 沒涵蓋該行為 → 停下，經 work-route 判定它是 bug 還是沒寫下的行為（後者以 ADD delta 補進 truth）。

## NEVER

1. **NEVER** 為了讓舊測試變綠，把產品碼改回 truth 已改寫的行為。
2. **NEVER** 刪掉 truth 沒涵蓋的舊測試來求綠——它是該行為唯一的紀錄。
3. **NEVER** 在舊測試檔裡新增 case，也 **NEVER** 在凍結 commit 之後加 marker——凍結日之後建立的檔、以及 `unmark` 過的檔都一樣（`.legacy-tests.json` 進 commit 後 `mark` 一律拒絕；手寫的會被 `status` 列進 `late_marked`）。
4. **NEVER** 把舊測試的 helper、fixture、page object 當成 `/bdd` 盤點既有抽象時可沿用的對象。`/bdd` Rule 1／4 的「優先沿用」對舊測試不適用；step 層的抽象依 truth 的 DSL 建立。

## Reference signal（不 block）

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `status` 的 `late_marked` 或 `malformed` 非空 = 違規，移除該 marker；`post_freeze_unmarked` 非空 = 逐支確認是純邏輯不變量，不是就改寫成 scenario。**warn-only**，exit 0 |
| 消費端 | 在該 consumer 工作、碰到測試檔的 agent；clade 主持者跑 `scripts/audit-legacy-tests.ts` 取 fleet 表進 HANDOFF 稽核段，WARN／NOT-FROZEN，以及 `sealed` 為 false 的 OK 列（沒有 `.legacy-tests.json` 的凍結：`mark` 仍開放）relay 給該 consumer |
| 觸發點 | 本檔（`clade-spec-workflow` skill 的 `rules/legacy-tests.md`）；每支舊測試的 marker 行指回本檔 |
