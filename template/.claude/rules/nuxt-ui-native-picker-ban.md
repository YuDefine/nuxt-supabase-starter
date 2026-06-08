---
description: 禁止原生 / 第三方 date / time / calendar picker，改用 Nuxt UI 元件；實作階段強制（不等 /commit review 才抓）
paths: ['app/**/*.{vue,ts}', 'pages/**/*.vue', 'components/**/*.vue', 'layouts/**/*.vue']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/nuxt-ui-native-picker-ban.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# 禁止原生 / 第三方 Date / Time Picker（實作階段強制）

**核心命題**：原生 HTML date / time picker 與第三方 date picker 在不同瀏覽器外觀不一致、無法套 design system theming（含 dark mode）、a11y 不可控、無法本地化日期格式（zh-TW vs en-US）、不支援 disabled date / range / min-max / highlight 等需求。`@nuxt/ui` 對應元件是唯一正解。

此規約已存在於 **review 層**（`plugins/hub-core/agents/references/clade-review-rules.md` § 原生 HTML date / time / calendar 輸入，由 code-review agent 在 `/commit` 0-A review 時抓）。本檔把同一條規約**提前到 implementation 階段**（path-scoped，寫 `.vue` 當下就生效），讓違規在寫的時候就被擋，而不是等到 review 才回頭改。配套 mechanical gate `vendor/scripts/pre-commit/checks/native-picker-ban.sh`（pre-commit 自動跑，staged `.vue` scope）。

> **為何要 impl-time + review 兩層**：review-time rule 是最後一道網，但「寫完整批才被 review 退回」成本高、context 已散。把規約做成 path-scoped impl-time rule + pre-commit gate，讓 enforcement 在最接近犯錯的時點觸發。這跟 [[nuxt-ui-conventions]]（慣例一致性同樣 impl-time 強制）是同一個 spirit。

## 禁止

| 類型 | 範例 | 為什麼不行 |
| --- | --- | --- |
| 原生 HTML input | `<input type="date">` / `datetime-local` / `time` / `month` / `week` | 跨瀏覽器外觀不一致、無法套 design system / dark mode / i18n |
| `UInput` 偽裝 | `<UInput type="date">` / `<UInput type="time">` / `datetime-local` / `month` / `week` | `UInput` 只是 wrapper，底層仍走原生 picker，跟上面同問題 |
| 第三方 picker | `v-calendar` / `@vuepic/vue-datepicker` / `flatpickr` / `vue-flatpickr-component` / `vue-datepicker` | 多一條 design system / dark mode / i18n drift 來源 |

## 正解

| 需求 | 用什麼 |
| --- | --- |
| 日期 / 日期區間 | `<UCalendar>` + `<UPopover>` 做 trigger |
| 純時間 | `<USelectMenu>` / `<UInputMenu>` 提供固定時間選項，或專案內部封裝的時間選擇器 |
| 日期 + 時間 | `<UCalendar>` + 時間選擇器組合 |

**MUST**：寫上述任一元件**之前**，先查 `nuxt-ui-remote` MCP 取得 `<UCalendar>` / `<UPopover>` / `<USelectMenu>` 的當前版本 API（per [[nuxt-ui-mcp]]）。**NEVER** 憑訓練記憶寫 props / slot — Nuxt UI 是 fast-moving 套件，記憶的 API 多半過時。

## 例外

純後端工具腳本、admin debug 內部頁面、第三方套件強制原生 HTML 元素可豁免，**MUST** 在 commit message / PR 註明位置與理由。`<input type="color">` 等非日期 / 時間類 picker 不在本條範圍。

## 雙生規約

- **review 層**：`plugins/hub-core/agents/references/clade-review-rules.md` § 原生 HTML date / time / calendar 輸入（含 reviewer grep 檢查方式）
- **mechanical gate**：`vendor/scripts/pre-commit/checks/native-picker-ban.sh`（pre-commit 自動跑，掃 staged `.vue`）
- **API 正確性**：[[nuxt-ui-mcp]]
- **慣例一致性**：[[nuxt-ui-conventions]]
