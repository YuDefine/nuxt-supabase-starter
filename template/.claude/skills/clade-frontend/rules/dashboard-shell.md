---
description: Nuxt dashboard 外殼（layout、側欄、全站日期區間 picker、sheet／drawer、全站快捷鍵）的互動判準
paths: ['app/layouts/**', 'packages/*/app/layouts/**', 'layers/*/app/layouts/**', 'app/components/**/*Dashboard*.vue', 'packages/*/app/components/**/*Dashboard*.vue', 'layers/*/app/components/**/*Dashboard*.vue', 'app/components/**/dashboard/**', 'packages/*/app/components/**/dashboard/**', 'layers/*/app/components/**/dashboard/**', 'app/composables/**/*Dashboard*.ts', 'packages/*/app/composables/**/*Dashboard*.ts', 'layers/*/app/composables/**/*Dashboard*.ts', 'app/composables/**/dashboard/**', 'packages/*/app/composables/**/dashboard/**', 'layers/*/app/composables/**/dashboard/**']
---
<!-- Clade native rule; source: rules/modules/framework/nuxt/dashboard-shell.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Dashboard 外殼

外殼元件的選用（`UDashboardGroup`／`UDashboardSidebar`）與主題切換見 [[nuxt-ui-conventions]] § Dashboard 外殼與主題；本檔只管外殼上的互動狀態。

## 日期區間 picker

外殼或頁首有一個控制整頁資料區間的 picker 時：

- **草稿 → 套用兩段式**：打開時以已套用區間初始化草稿；點日期與點 preset 只改草稿；按「套用」才寫回已套用區間並觸發查詢；未套用就關閉＝丟棄草稿。**NEVER** 每點一次日期就重新查詢——選區間的第一下會先用半個區間打一次 API。
- **preset 的選中狀態用比對算出**：拿草稿區間與每個 preset 當下算出的區間比對，相等的那個標成選中。**NEVER** 另存一個 `selectedPreset` 旗標——使用者選了「近 7 天」再手動改一天，旗標仍亮著，標示就在說謊。
- **週起始日全站固定一個值**：picker 的 `week-starts-on` 與「本週」「上週」preset 的計算用同一個常數；後端依週彙總時（[[display-value-integrity]] § 聚合位置）也讀這個值，**NEVER** 讓 SQL 用自己的預設（PostgreSQL `date_trunc('week', …)` 固定從週一起算）——週日起算的畫面配週一起算的彙總，每一週的數字都錯開一天。
- 區間值用 `CalendarDate`，進出元件是 `YYYY-MM-DD`；時區判準見 [[timezone]]，最小示意見 `vendor/snippets/nuxt-calendar-field/`。

## Sheet／drawer 與快捷鍵

- 全站同時最多開一個 sheet（slideover／drawer）：開啟狀態由一支 composable 持有單一值（目前開著的 sheet id 或 `null`），開新的就關掉舊的。各頁 **NEVER** 各自持有 `open` 布林——兩個 sheet 疊在一起時 focus trap 與 Esc 會互搶。
- 路由切換時 **MUST** 自動關閉開著的 sheet（監聽 route 變化或 `router.afterEach`），否則換頁後殘留上一頁的 sheet。
- 快捷鍵 **MUST** 用 `defineShortcuts` 註冊，**NEVER** 自掛 `window` 的 `keydown` listener——自掛的不會避開輸入框焦點、不會隨元件卸載移除，也看不出與其他快捷鍵衝突。
