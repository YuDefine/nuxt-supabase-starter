# Product

<!-- impeccable:product-schema 1 -->

> 本檔描述的是 **nuxt-supabase-starter 樣板本身**（`template/` 是新案的 seed），讓 commit 0-B.1 對樣板生效。
> 新案 **不會** 繼承本檔：`scripts/create-clean.sh` 依 `presets/_base/strip-manifest.json` 剝掉 `PRODUCT.md`、`DESIGN.md`、`.impeccable/`；
> `create-nuxt-starter` 的 `templates/base/` 也刻意不放 seed。新專案沒有 PRODUCT.md，impeccable context 回 `NO_PRODUCT_MD`，
> 第一次做 UI 時走 `/impeccable init` 與使用者訪談後才建立（之後 0-B.1 生效）。

## Platform

web

## Users

- 主要使用者：已熟悉 Nuxt／Vue、想用 Supabase 快速建立「有後端、有資料庫、有認證、可部署」全端專案的開發者（出處：meta repo `README.md`「目標讀者」）。
- 情境：開新案、或把既有專案整合進同一套全端工作流程；多數時間與 Claude Code 等 AI coding agent 協作。
- 樣板內頁面（首頁、demo、auth、profile、admin/users）的終端使用者是「看樣板的開發者」，不是任何實際客戶。

## Product Purpose

把中型企業系統的開發經驗（認證、CRUD、RLS、CI/CD、部署、AI 協作工作流程）預先組好，讓新專案在數天內達到通常要數週的起點。成功＝新案從 clone 到可運行約 15 分鐘、第一個功能約 20 分鐘（出處：`README.md`「開發時間」表）。

## Positioning

不是單純 boilerplate：附帶實際踩過的坑、驗證過的模式與反模式，以及與 Claude Code 協作的規則與 skill 投影（clade consumer）。

## Operating Context

- 兩條建案路徑：直接 clone `template/`（`pnpm setup`），或跑 `create-nuxt-starter` 依 feature（auth、database、ui、charts、ssr、seo、security）組裝。
- 文件入口：`PROMPT.md`、`docs/QUICK_START.md`、`docs/INTEGRATION_GUIDE.md`、`docs/FIRST_CRUD.md`。
- 介面語言：zh-TW（`app/app.vue` 掛 `@nuxt/ui` 的 `zh_tw` locale），部分樣板 UI 文案仍為英文。

## Capabilities and Constraints

- Stack：Nuxt 4、Nuxt UI（Tailwind CSS v4）、Supabase（PostgreSQL＋Auth＋RLS）、Cloudflare Workers 部署、Vitest／Playwright。
- 樣板 **刻意不帶品牌**：`app/app.config.ts` 的 `ui` 不寫 `colors`，品牌色由新專案 bootstrap 時的 impeccable follow-up 問過使用者後才寫。
- 頁面骨架共用元件：`AppPageShell`（標題／actions／stats／subnav／toolbar slots）、`AppFormLayout`、`AppEmptyState`。
- 支援 light／dark 雙色模式切換（`useColorMode`）。

## Brand Commitments

無。樣板本身不承諾品牌；任何品牌色、字型、Logo 都屬於衍生專案的決策（待各專案確認）。

## Evidence on Hand

- 無客戶、testimonial、案例或成效數據；NEVER 在樣板頁面或文件中編造。
- 費用估算見 `README.md`「月費估算」（去敏感化量級，非報價）。

## Product Principles

1. 樣板只提供結構與預設，不替衍生專案做品牌決策。
2. 每個預設都要能被新專案安全覆寫或移除（feature overlay、strip manifest）。
3. 流程與規則優先於範例畫面：範例頁是驗證 golden path 用的，不是設計範本。
