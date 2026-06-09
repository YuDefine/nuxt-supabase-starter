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

此規約有**四層** enforcement，各管不同 scope：

| 層 | scope | 何時跑 | 觸發成本 |
| --- | --- | --- | --- |
| **impl-time rule** | 當次 session 寫的 `.vue`（path-scoped 自動 load） | 寫 code 當下 | 零延遲，最接近犯錯時點 |
| **pre-commit gate** | staged `.vue` | `git commit` | 秒級，擋住增量違規 |
| **pre-push gate** | **每個** Nuxt consumer 的**全 repo** `.vue`（含歷史既有檔，不只當次 staged） | `git push` | 秒級，擋住既有違規與 `--no-verify` 繞過 |
| **review 層** | PR diff | code-review agent / `/commit` 0-A | 最後一道網 |

前三層是 mechanical gate（自動擋），review 層是人類 / agent semantic check。**MUST** 把 pre-push gate 視為「全站事實檢查」——`grep -rEn 'type="(date|...)"' --include='*.vue' .` 永遠應該回傳 0 hit，pre-push 失敗就是有違規進入 codebase。

> **為何四層**：review-time 是最後一道網，但「寫完整批才被 review 退回」成本高、context 已散。再加上 review 只看 diff、pre-commit 只看 staged——歷史檔的違規會默默累積成債（規則上線前的 code、繞過 pre-commit 進來的 code）。pre-push 全站掃描是「回溯型」gate，補上前三層的盲區，讓**每個** Nuxt consumer 在 push 前都做一次事實校對。這跟 [[nuxt-ui-conventions]]（慣例一致性同樣 impl-time 強制）是同一個 spirit。

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

## 例外（inline ignore）

合法例外（純後端工具腳本、admin debug 內部頁面、第三方套件強制原生 HTML 元素）在違規行加 `picker-ban-ignore` 標記即繞過機械 gate。理由：機械 gate 讀不到 commit message rationale，inline 標記讓合法例外能繞過 pre-push 全站掃描：

```vue
<UInput type="date" />  <!-- picker-ban-ignore: internal debug page -->
```

仍**MUST** 在 commit message / PR description 註明位置與理由，讓 review 層核實。`<input type="color">` 等非日期 / 時間類 picker 不在本條範圍。

## CI gate（採用範本，consumer 自治）

pre-push hook 可被 `--no-verify` / web 編輯介面繞過。要 PR merge 級無法繞過的強制，consumer 在自家 CI workflow 加一個 step 直接重用已 vendored 的 script：

```yaml
# .github/workflows/ci.yml
- name: Native picker ban (repo-wide)
  run: bash scripts/pre-push/checks/native-picker-ban.sh
```

clade 不替 consumer 改 workflow（各自治），只提供範本。clade 待辦稽核段追蹤 5 consumer 的採用狀況。

## 規約來源

- **review 層**：`plugins/hub-core/agents/references/clade-review-rules.md` § 原生 HTML date / time / calendar 輸入（含 reviewer grep 檢查方式）
- **pre-commit gate**：`vendor/scripts/pre-commit/checks/native-picker-ban.sh`（掃 staged `.vue`）
- **pre-push gate**：`vendor/scripts/pre-push/checks/native-picker-ban.sh`（掃**全 repo** `.vue`，回溯型）
- **API 正確性**：[[nuxt-ui-mcp]]
- **慣例一致性**：[[nuxt-ui-conventions]]
