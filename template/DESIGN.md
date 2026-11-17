---
name: Nuxt Supabase Starter
description: 不帶品牌的 Nuxt UI 預設外觀，留給衍生專案決定視覺世界
typography:
  title:
    fontSize: "1.25rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
rounded:
  lg: "0.5rem"
  full: "9999px"
components:
  page-title:
    typography: "{typography.title}"
  card:
    rounded: "{rounded.lg}"
---

# Design System: Nuxt Supabase Starter

## Overview

**Creative North Star: "The Unbranded Workbench"**（AI 從現有程式推得，待 Charles 確認）

樣板刻意維持 Nuxt UI 的出廠外觀：語意色（`primary`、`neutral`、`--ui-bg`、`--ui-text-*`、`--ui-border`）全部走 Nuxt UI 的 fallback，`app/app.config.ts` 不設 `ui.colors`，`app/assets/css/main.css` 只匯入 `tailwindcss` 與 `@nuxt/ui`，不宣告字型或自訂 token。這是結構性的空白：衍生專案在 bootstrap 時用 impeccable 決定品牌，再以 `/impeccable document` 重寫本檔。

版面是標準的應用程式殼：頂部 header（高 64px、底邊框）、主內容置中容器、底部 footer；認證頁改用置中單卡。密度中等、以邊框而非陰影分層。

**Key Characteristics:**
- 零品牌：顏色、字型全數繼承 Nuxt UI 預設，支援 light／dark。
- 以語意 CSS 變數上色（`bg-(--ui-bg)`、`text-(--ui-text-muted)`、`border-(--ui-border)`），不寫死色碼。
- 共用頁面骨架 `AppPageShell` 統一標題、操作區與工具列位置。

## Colors

沒有自訂調色盤；所有角色色由 Nuxt UI 的語意 token 提供。

### Primary
- **Nuxt UI Primary**（模組 fallback，未覆寫）：主要按鈕、空狀態圖示底（`bg-primary/10`）、首頁 feature 圖示。

### Neutral
- **UI Background**（`--ui-bg`）：頁面底色。
- **UI Elevated**（`--ui-bg-elevated`）：程式碼區塊等次層表面。
- **UI Border**（`--ui-border`）：header／footer／行動版 nav 的分隔線。
- **Highlighted / Muted Text**（`--ui-text-highlighted`、`--ui-text-muted`）：標題與次要說明文字。

### Named Rules
**The Semantic Token Rule.** 元件只用 Nuxt UI 語意 token 上色；首頁 demo 的 `green`／`orange`／`purple` 圖示底是展示用，衍生專案 MUST 改成品牌色或語意色。

## Typography

**Body Font:** Nuxt UI／Tailwind 預設 sans-serif 系統字（未宣告 `--font-sans`；要換字型時在 `@theme` 宣告，由 `@nuxt/fonts` 載入，NEVER 用 `@import url()`）。

### Hierarchy
- **Display**（bold、`text-4xl`）：首頁 hero 標題。
- **Headline**（semibold、`text-2xl`）：首頁區段標題。
- **Title**（semibold、`text-xl`→`sm:text-2xl`、tracking-tight）：`AppPageShell` 頁面標題，單行截斷。
- **Body**（`text-sm`～`text-lg`）：說明文字，次要說明用 muted 色。
- **Label**（`text-xs`、muted 70%）：空狀態補充說明。

## Layout

- 應用殼（`layouts/default.vue`）：header `h-16`、`UContainer` 主內容 `py-8`、footer `h-14`；`sm` 以下導覽改到 header 下方一列。
- 認證殼（`layouts/auth.vue`）：全高置中、`max-w-md` 單卡，右上角固定色彩模式切換。
- 頁面骨架（`AppPageShell`）：垂直 `gap-6`，依序 breadcrumb（行動版隱藏）→ 標題＋actions → stats → subnav → toolbar → 內容。
- 卡片格線：`sm:grid-cols-2 lg:grid-cols-4`、`gap-4`。

## Elevation & Depth

扁平：以邊框（`--ui-border`）與表面色（`--ui-bg-elevated`）分層，樣板程式碼沒有自訂陰影；`UCard` 等元件的深度沿用 Nuxt UI 預設。

## Shapes

中等圓角（`rounded-lg`，0.5rem）用於圖示底與程式碼區塊；空狀態圖示底用正圓（`rounded-full`）。其餘元件沿用 Nuxt UI 預設圓角。

## Components

### Buttons
- 一律用 `UButton`；主要動作用預設 solid，次要用 `variant="outline"`／`soft`，工具型 icon 按鈕用 `variant="ghost" color="neutral"`。

### Cards / Containers
- `UCard` 包內容；認證頁整頁就是一張卡。

### Navigation
- `UNavigationMenu`：桌機在 header 內水平，行動版移到 header 下獨立一列；使用者選單走 `UDropdownMenu`。

### Empty State（`AppEmptyState`）
- 置中、`py-10`；正圓 primary/10 圖示底＋muted 訊息（`max-w-xs`）＋可選 outline 小按鈕。

## Do's and Don'ts

### Do:
- **Do** 衍生專案決定品牌後在 `app.config.ts` 設 `ui.colors`，並重跑 `/impeccable document` 改寫本檔。
- **Do** 新頁面套 `AppPageShell`，空清單用 `AppEmptyState`。

### Don't:
- **Don't** 在樣板層寫死品牌色或字型；那是衍生專案的決策。
- **Don't** 在元件裡寫十六進位色碼取代語意 token。
