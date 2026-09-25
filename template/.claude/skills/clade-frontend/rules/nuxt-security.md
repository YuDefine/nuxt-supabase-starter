---
description: nuxt-security 模組設定 baseline — CSP、headers、CSRF 共用值與 per-consumer 擴充規範
paths: ['nuxt.config.ts']
---
<!-- Clade native rule; source: rules/modules/framework/nuxt/nuxt-security.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Nuxt Security Baseline

本 rule 適用於有裝 [`nuxt-security`](https://nuxt-security.vercel.app/) 模組的 Nuxt consumer。**目的**：把多個 consumer 重複出現的 CSP / headers / CSRF baseline 統一規範化，避免各 consumer 漂移；保留 per-consumer 必然差異（`connect-src` / `script-src` / `csurf` 例外）讓專案各自宣告。

## Baseline（必對齊欄位）

`security` 區塊**MUST** 包含以下 baseline。**禁止**修改值（除非有書面 ADR 記錄理由）：

```ts
security: {
  rateLimiter: false,                        // CF Workers 相容；自架 Nitro 也建議走 reverse proxy 做 rate limit
  headers: {
    crossOriginEmbedderPolicy: false,        // 避免擋 SSR images
    contentSecurityPolicy: {
      'base-uri': ["'none'"],
      'font-src': ["'self'", 'https:', 'data:'],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'object-src': ["'none'"],
      'script-src-attr': ["'none'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'upgrade-insecure-requests': true,
      // ⬇ 以下四條 per-consumer 必填或選填，見下節
      // baseline 預設含 'self' + 'https://cloudflareinsights.com'（CF Web Analytics beacon report endpoint）
      'connect-src': ["'self'", 'https://cloudflareinsights.com', /* per-consumer extend */],
      // 'script-src': [...],   // 選填；若啟用 MUST 同時含 'https://static.cloudflareinsights.com'（CF beacon CDN）
      // 'frame-src': [...],    // 選填
      // 'worker-src': [...],   // 選填（用到 Web Worker / blob worker 時）
    },
    xFrameOptions: 'DENY',
  },
  csrf: true,
}
```

## Per-consumer 必填欄位

- **`connect-src` MUST 明列**：至少 `'self'` + baseline 的 `https://cloudflareinsights.com`（即使不部署到 CF），再加所有 production 用到的外部 API host，以及 dev mode 會 fetch 的 CDN。**NEVER** 用 `https:` 全開；**NEVER** 把 secret token 透過 query string 傳給沒列入 `connect-src` 的 endpoint；self-hosted Supabase 明列 host，不用 wildcard
- **`script-src` / `frame-src`（選填）**：只在用到第三方 widget 時加；啟用 `script-src` 就 **MUST** 含 `https://static.cloudflareinsights.com`
- **`worker-src`（選填）**：用 Web Worker / `blob:` worker 時 `["'self'", 'blob:']`

## Integration Recipes（按 integration 組合 CSP）

Consumer 的 CSP = baseline + 所有用到的 integration recipes 聯集。`scripts/audit-nuxt-security.ts` 自動偵測 integration 並 cross-check。

| Integration | 偵測 | 需要的 directive |
| --- | --- | --- |
| Cloudflare Web Analytics | 部署到 Cloudflare（預設全部） | baseline 已含（見 § Cloudflare Web Analytics beacon） |
| Nuxt UI / Iconify | `@nuxt/ui` | `connect-src`: `https://api.iconify.design`（改 `@nuxt/icon` `provider: 'server'` 可免） |
| Sentry | `@sentry/nuxt` | `connect-src`: `https://*.ingest.sentry.io`, `https://*.ingest.us.sentry.io` |
| Supabase（client-side） | `@nuxtjs/supabase` 且 client 有 `useSupabaseClient()` | `connect-src`: `https://*.supabase.co` 或明列 self-hosted host（只在 server 存取則不加） |
| Google OAuth / Identity Services | `vue3-google-login` 或 GIS 套件 | `script-src`: `https://accounts.google.com/gsi/client`；`connect-src` / `frame-src`: `https://accounts.google.com` |
| LINE OAuth / LIFF | LINE Login / LIFF SDK 或 `line.me` 出現在 nuxt.config | `connect-src`: `https://*.line.me`, `https://*.line-scdn.net`, `https://*.line-apps.com` |
| @nuxt/content v3（WASM） | `@nuxt/content` v3+ | `script-src`: `'wasm-unsafe-eval'`，擴大 XSS 攻擊面，**MUST** 記 ADR（`docs/decisions/YYYY-MM-DD-csp-wasm-unsafe-eval.md`） |
| Dev HMR（tunnel 環境） | `.env*` 有 `TUNNEL_HOSTNAME` | dev-only `connect-src`: `...(import.meta.dev ? ['ws:', 'wss:'] : [])`（cookbook `~/offline/clade/vendor/snippets/nuxt-security-dev-csp/`） |

## CSRF 例外（`routeRules.csurf`）

`csrf: true` 預設啟用，但以下路徑**MUST** 透過 `routeRules` 顯式關閉，否則會被擋（HTTP 403 CSRF Token Mismatch）：

```ts
routeRules: {
  // better-auth 自帶 CSRF 保護，避免雙重檢查衝突
  '/api/auth/**': { csurf: false },

  // MCP endpoints — Bearer token 認證、無狀態，不需要 CSRF
  '/mcp/**': { csurf: false },

  // Setup / Bootstrap endpoints — secret token 保護
  '/api/setup/**': { csurf: false },

  // Webhook endpoints — 第三方 POST 過來，沒 cookie / 沒 CSRF token；
  // 改以 HMAC 簽名 / Bearer token / 共享 secret 取代 CSRF 防護
  '/api/webhooks/**': { csurf: false, security: { csrf: false } },
  '/api/v1/<provider>/webhook': { csurf: false, security: { csrf: false } },

  // Dev-only endpoints
  '/api/_dev/**': { csurf: false },
  ...(process.env.NODE_ENV !== 'production' && {
    '/__nuxt_hints/**': { csurf: false },
  }),
},
```

**規則**：
- **MUST** 每條 csurf 例外都附 inline 註解說明**為什麼安全**（用什麼機制取代 CSRF 防護）
- **MUST** 凡是有 `server/api/webhooks/**` 或 `server/api/**/webhook.{post,get}.ts` 結構的 endpoint，**必須**有對應的 `routeRules` csurf 例外。沒設例外 = 第三方 POST 永遠收到 403，等同 endpoint 從未存在；常見症狀是「告警 / payment / build hook 永遠不觸發，但 endpoint code 看起來沒問題」
- **MUST** webhook endpoint 必須在 handler 內以 HMAC 簽名 / Bearer token / 共享 secret 驗證來源；csurf 例外不是「免驗證」而是「換驗證機制」
- **NEVER** 用 wildcard 整段豁免（例如 `/api/**: { csurf: false }`）
- **NEVER** 對讀取 session cookie 的 endpoint 關 CSRF
- 加新 `/mcp/**` 或 `/api/auth/**` 路由前**MUST** 確認：要嘛 Bearer token、要嘛 GET-only 且不存取 session

新增 webhook endpoint 時 **MUST** 對照 `server/api/webhooks/**`（及 `**/webhook.{post,get}.ts`）與 `nuxt.config.ts` 的 csurf 例外，對不上就必定 403；部署後 `curl -X POST` 驗收一次。

## Cloudflare Web Analytics beacon

部署到 Cloudflare 的 site，zone 開啟 Web Analytics **Automatic Setup**（default 開）時，Cloudflare 會在所有 HTML 注入 `https://static.cloudflareinsights.com/beacon.min.js` 並 POST 到 `https://cloudflareinsights.com/cdn-cgi/rum`；CSP 未白名單這兩個 host 就會持續報 CSP violation。所以 baseline `connect-src` 已含 `https://cloudflareinsights.com`，`script-src`（若 enable）**MUST** 含 `https://static.cloudflareinsights.com`，不論當前部署平台。關閉 zone 的 Automatic Setup 會影響整個 zone 與 production analytics，**不推薦**。

對應 pitfall：`docs/pitfalls/2026-05-24-cloudflareinsights-beacon-csp-blocked.md`。

## CF Workers 相容性

Consumer `runtime: cf-workers` 時：

- **MUST** `rateLimiter: false`（Workers 沒 in-memory state，nuxt-security 的 in-process rate limiter 沒用）
- **改用 Cloudflare Rate Limiting**（透過 wrangler `[[unsafe.bindings]]` 或 zone-level rule）做 rate limit
- `csrf` 在 Workers 上正常工作（cookie-based double-submit token）

## 升級與 drift 檢查

nuxt-security 大版升級時先在一個 consumer 試水，確認 baseline 欄位與 `routeRules.csurf` 語法仍適用；有 breaking change 就同步更新本 rule 並開 ADR。偏離 baseline 的任何欄位 **MUST** 記錄到 `docs/decisions/YYYY-MM-DD-csp-<topic>.md`。
