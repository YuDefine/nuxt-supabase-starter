---
description: 實作 Nuxt UI component 前強制 grep 既有同語義用法、複製多數 props 組合；慣例一致性在實作時對齊，不等 review 才抓
paths: ['app/**/*.vue', 'pages/**/*.vue', 'components/**/*.vue', 'layouts/**/*.vue']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/nuxt-ui-conventions.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Nuxt UI 專案慣例一致性（實作階段強制）

**核心命題**：[[nuxt-ui-mcp]] 保證 **API 正確性**（prop / slot / theming key 存在、未過時），但不保證**專案內慣例一致性**（同語義角色用同 props 組合）。同一個 `<UButton>` 主動作在 A 頁面寫 `color="primary" variant="solid"`、B 頁面寫 `color="green"`，兩者 API 都對但視覺漂移。本規約補上後者：讓慣例在**實作當下**對齊，不等 `/commit` review 或人工抓。

> **為何 impl-time**：API 錯誤 typecheck / MCP 會擋，但慣例不一致 typecheck 抓不到、只有人 review 時肉眼比對才發現 —— 而 review 是最貴、最晚的關卡。把「寫前 grep 既有用法」做成 path-scoped impl-time 規約，讓一致性在最接近犯錯時點就對齊。這跟 [[nuxt-ui-native-picker-ban]]（同樣 review-time → impl-time 提前）是同一個 spirit。

## Hard rule

寫任何 Nuxt UI component（`<UButton>` / `<UBadge>` / `<UInput>` / `<USelect>` / `<USwitch>` / `<UTable>` / `<UAlert>` 等）**之前**，**MUST**：

1. **判定語義角色**：這個 component 在此處扮演什麼角色？（主動作 / 次要動作 / 破壞性動作 / 狀態標籤 / 表單欄位 / 表格行內操作 …）
2. **grep 既有用法**：`grep -rn '<U<Component>' app/ --include='*.vue' | head -10`，找同語義角色的既有 props 組合
3. **複製多數寫法**：用既有最多頁面採用的 props 組合，**NEVER** 憑直覺自己配 `color` / `variant` / `size`

## 不一致時

- 既有頁面之間本身不一致 → 以**最多頁面採用**的寫法為準
- 新增一種既有沒有的語義角色 → 採用該專案 design system 文件（若有，如 `.impeccable.md` Component Conventions 段）決定，並在 commit message / PR 留言說明新增的角色

## 禁止事項

- **NEVER** 不 grep 就直接寫 Nuxt UI component 的 `color` / `variant` / `size`
- **NEVER** 依賴預設值（「不寫 size 就是 md 吧」）— 顯式寫出，跟既有多數一致
- **NEVER** 新增元件用法時跳過語義角色判定（「只是一個小 badge」）
- **NEVER** 自行發明既有沒有的 props 組合而不 grep 驗證

## 雙生規約

- **API 正確性（props 存在 / 未過時）**：[[nuxt-ui-mcp]]
- **原生 picker ban（同 impl-time enforcement spirit）**：[[nuxt-ui-native-picker-ban]]

> 本規約是「慣例一致性」baseline，各 consumer 的具體語義角色 × props 對照表是 project-specific 知識，**SHOULD** 在 consumer 自家 `.claude/rules/local/` 維護對照表（clade 只規範「寫前必 grep 既有」這條跨 consumer 通則）。
