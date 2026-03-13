## Why

目前沒有安全性 headers 或 SEO 配置。nuxt-security 模組提供 OWASP Top 10 防護（CSP、XSS、CSRF），但社群大多數 starter 未納入。SEO 基礎（sitemap、robots、meta tags）是所有 production 網站的基本需求。作為 starter，預設納入這些能確保每個衍生專案都有安全基線。

## What Changes

### Infrastructure（clean 版保留）

- 安裝 `nuxt-security` module：
  - 配置 security headers（CSP、X-Frame-Options、X-Content-Type-Options）
  - Rate limiting for API routes（`/api/**`）
  - CSRF protection
  - 適當的 Cloudflare Workers 相容設定
- 安裝 `@nuxtjs/seo` module（all-in-one：sitemap + robots + OG + Schema.org）：
  - 配置 `site.url` 與 `site.name`
  - 建立基礎 `useSeoMeta()` 範例在 `app.vue`
  - 配置 robots（阻擋 /auth/_, /api/_）
  - Sitemap 自動生成
- 更新 `nuxt.config.ts` 新增 modules 與配置

## Capabilities

### New Capabilities

- `security-headers`: OWASP 安全性 headers + rate limiting + CSRF
- `seo-foundation`: Sitemap + Robots + OG tags + Schema.org 基礎配置

### Modified Capabilities

(none)

## Impact

- 修改 `nuxt.config.ts`
- 修改 `package.json`（新增 dependencies）
- 全部為 infrastructure，clean 版保留
- 不需要 migration
- 注意：nuxt-security 在 Cloudflare Workers 環境可能需要特殊配置（rate limiting storage）
