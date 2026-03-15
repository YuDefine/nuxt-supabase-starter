# Changelog

本專案遵循 [Keep a Changelog](https://keepachangelog.com/) 格式。

## [0.11.0] - 2026-03-15

### Added

- `setup.sh` 跨平台支援（macOS、Windows WSL、Linux）與互動式 Tech Stack 選擇
- 文件品質審查與內容更新

### Changed

- CI/CD workflow 移至 `docs/templates/` 作為範本
- Node.js 版本要求統一為 18+（建議 24 LTS）
- Skills 安裝腳本更新

### Fixed

- `pnpm setup` 改為 `pnpm run setup` 避免執行內建指令

## [0.10.0] - 2026-03-14

### Added

- `create-nuxt-starter` CLI 互動式建立工具
- Setup 自動化腳本與改善應用頁面

### Changed

- 全面改善新人體驗文件（評分 6.5 → 8.6）
- 歸檔 5 個 Spectra changes（79 tasks 完成）

## [0.9.0] - 2026-03-13

### Added

- CI/CD pipeline（GitHub Actions）+ Cloudflare Workers 部署
- E2E 測試基礎（Playwright + smoke/auth tests）
- Security headers + SEO 配置（nuxt-security, @nuxtjs/seo）
- 前端查詢 patterns（Pinia Colada + demo pages）
- 雙模式架構（create-clean + validate + backup scripts）
- Sentry + evlog plugins
- Nuxt 環境測試

## [0.8.0] - 2026-03-12

### Changed

- 重構 domain skills 加入 frontmatter 和 progressive disclosure
- 替換 vue/vueuse/vitest/vue-best-practices skills 為官方 antfu/skills 版本
- 更新第三方 skills 至最新版本
- 移除 6 個重複的 skills symlink

## [0.7.0] - 2026-03-11

### Added

- find-skills skill
- Skills 管理腳本（install/update/list）
- OpenSpec / Spectra 選擇機制
- Skills 同步與專案檢查清單文件

## [0.6.0] - 2026-03-10

### Added

- 智能路由指令

### Changed

- validate-starter 整合為純 command

## [0.5.0] - 2026-03-09

### Added

- Spectra 工作流程

### Fixed

- 移除自動執行 pnpm check 觸發器

## [0.4.0] - 2026-03-08

### Added

- Supabase postgres-best-practices skill

## [0.3.0] - 2026-03-07

### Added

- Nuxt UI 繁體中文語系支援
- OXLint + OXFmt 配置

### Changed

- Supabase 金鑰命名更新為 Publishable/Secret

### Fixed

- 移除無效的 PWA manifest 連結

## [0.2.0] - 2026-03-06

### Added

- 初始版本：Nuxt 4 + Supabase + Better Auth + Nuxt UI
- 5 個情境觸發 Skills
- 完整文件（QUICK_START、FAQ、TROUBLESHOOTING 等）
- docs/verify/ 系統狀態文件
- Supabase MCP 配置
