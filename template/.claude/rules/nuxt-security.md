---
description: nuxt-security 模組設定 baseline — CSP、headers、CSRF 共用值與 per-consumer 擴充規範
paths: ['nuxt.config.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/nuxt-security.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# Nuxt Security Baseline

本 rule 適用於有裝 [`nuxt-security`](https://nuxt-security.vercel.app/) 模組的 Nuxt consumer。**目的**：把 4+ 個 consumer 重複出現的 CSP / headers / CSRF baseline 統一規範化，避免各 consumer 漂移；保留 per-consumer 必然差異（`connect-src` / `script-src` / `csurf` 例外）讓專案各自宣告。

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
      // ⬇ 以下三條 per-consumer 必填或選填，見下節
      'connect-src': [...],
      // 'script-src': [...],   // 選填
      // 'frame-src': [...],    // 選填
      // 'worker-src': [...],   // 選填（用到 Web Worker / blob worker 時）
    },
    xFrameOptions: 'DENY',
  },
  csrf: true,
}
```

## Per-consumer 必填欄位

### `connect-src`

每個 consumer **MUST** 明列 `connect-src`，至少包含：

```ts
'connect-src': [
  "'self'",
  // 視 consumer 額外加：
  // 'https://api.iconify.design',         // 用 @nuxt/icon 且未切 server-bundle 時 dev mode 會打 iconify CDN
  // 'https://accounts.google.com',        // Google OAuth / Google Identity Services
  // 'https://*.supabase.co',              // Supabase managed
  // 'https://<your-self-hosted-supabase>',// Supabase self-hosted（明列 host，不要 wildcards）
  // 'https://*.ingest.sentry.io',         // Sentry SaaS
  // 'https://*.ingest.us.sentry.io',      // Sentry SaaS（US region）
  // 'https://*.line.me',                  // LINE LIFF / Login
],
```

**規則**：
- **MUST** 列入所有 production 用到的外部 API host
- **MUST** dev mode 會 fetch 的 CDN（`api.iconify.design` 等）也要列；想消除 dev 警告又不想 prod 暴露，可改用 `@nuxt/icon` 的 `provider: 'server'`（bundle 本地 icon，根本不打網路）
- **NEVER** 用 `https:` 全開
- **NEVER** 把 secret token 透過 query string 傳給沒列入 `connect-src` 的 endpoint（會被 CSP 擋且 leak 到瀏覽器歷史）

### `script-src` / `frame-src`（選填）

只在用到第三方 widget 時加：

```ts
'script-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/client'],
'frame-src': ["'self'", 'https://accounts.google.com'],
```

### `worker-src`（選填）

用 Web Worker / 載入 `blob:` worker（如某些 PDF / 影像處理 lib）時加：

```ts
'worker-src': ["'self'", 'blob:'],
```

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

### Webhook 例外的快速自查

任何 `server/api/webhooks/**` 或同義結構新增時，**MUST** 跑一次：

```bash
# 1. 列出所有 server-side webhook endpoint 實作
fd -e ts -p 'server/api/webhooks/' -p 'server/api/.*/webhook\.(post|get)\.ts'

# 2. 列出 nuxt.config 內的 csurf 例外
rg -nP "(csurf|security:\\s*\\{\\s*csrf)" nuxt.config.ts

# 3. 兩邊對照：每個 endpoint 路徑都要在 routeRules 有對應 wildcard / 顯式例外
```

對應不上 = 該 endpoint 對外 POST **必定** HTTP 403。建議部署後立刻 `curl -X POST` 一次驗收。

## CF Workers 相容性

Consumer `runtime: cf-workers` 時：

- **MUST** `rateLimiter: false`（Workers 沒 in-memory state，nuxt-security 的 in-process rate limiter 沒用）
- **改用 Cloudflare Rate Limiting**（透過 wrangler `[[unsafe.bindings]]` 或 zone-level rule）做 rate limit
- `csrf` 在 Workers 上正常工作（cookie-based double-submit token）

## 升級與 drift 檢查

每次 nuxt-security 大版升級（major / minor）時：

1. 先在 clade 跑一個 consumer 試水（建議 `nuxt-edge-agentic-rag` 或 `nuxt-supabase-starter`）
2. 確認 baseline 11 個欄位仍適用、`routeRules.csurf` 語法未變
3. 沒 breaking change → 照常 propagate；有 → 同步更新本 rule 並開 ADR

## 違反時

```
[Nuxt Security] baseline 不齊

問題：<檔案路徑> 的 security.headers.contentSecurityPolicy 缺少 <欄位>

修正：
  - 將該欄位補到 baseline 列出的值（不可任意修改）
  - 若有充分理由偏離，記錄到 docs/decisions/YYYY-MM-DD-csp-<topic>.md
```

```
[Nuxt Security] webhook endpoint 缺 csurf 例外

問題：<webhook endpoint 路徑> 存在於 server/api/webhooks/**，但 nuxt.config.ts 的
      routeRules 沒有對應的 { csurf: false, security: { csrf: false } } 例外。
      此 endpoint 對外 POST 一律收到 HTTP 403 CSRF Token Mismatch，第三方告警
      / payment / build hook 永遠不會觸發。

修正：
  - 在 nuxt.config.ts 加：
      routeRules: {
        '/api/webhooks/**': { csurf: false, security: { csrf: false } },
      }
  - 確認 handler 內已有 HMAC 簽名 / Bearer / 共享 secret 驗證取代 CSRF
  - 部署後 curl -X POST 該 endpoint 一次，確認不再回 403
```
