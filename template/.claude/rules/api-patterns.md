---
description: Server API 設計規範
paths: ["server/api/**/*.ts"]
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/runtime/cf-workers/api-patterns.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# API Patterns

**MUST** define request/response contracts in `shared/schemas/*` and derive exported types from the same module
**MUST** use Zod validation for all API inputs — `getValidatedQuery(event, schema.parse)` / `readValidatedBody(event, schema.parse)`
**MUST** call `requireAuth()` or `requireRole()` before any business logic
**MUST** use `getSupabaseWithContext(event)` for request-scoped database access
**MUST** parse outgoing handler payloads with response schema `parse()` before returning
**NEVER** use `getServerSupabaseClient()` as the default path in request handlers — reserve it for privileged system tasks
**MUST** log mutations to audit table — 表名與欄位慣例見 `db-schema/<variant>/audit-schema.md`
**MUST** use unified response format `{ data, pagination? }`
**NEVER** return raw database errors to client — use `handleDbError()` + `createError()` with user-friendly message
**MUST** `const log = useLogger(event)` as first line — see `logging.md` for evlog patterns

Reference: `docs/api/API_DESIGN_GUIDE.md` — 完整 API 設計指南含進階模式

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## OpenAPI Metadata Convention

當 consumer 在 `nuxt.config.ts` 開啟 `nitro.experimental.openAPI: true` 時，nitropack 的 `handlersMeta` rollup plugin 會對每個 server handler 跑 `esbuild.transform()` 掃 `defineRouteMeta()`。**MUST** 為每個 covered public API handler 宣告 metadata，否則 plugin 跑空轉且容易在壞 handler 上 cascade 出 `spawn EBADF` 連鎖錯誤。

### Covered handler 範圍

**MUST** 為 `packages/*/server/api/v1/**/*.{get,post,patch,delete,put}.ts` 每個 handler 在 module scope 宣告：

```ts
defineRouteMeta({
  openAPI: {
    tags: ['employees'],
    summary: '取得員工列表（admin 用）',
    parameters: [
      { in: 'query', name: 'department_id', required: false, schema: { type: 'string' } },
    ],
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: { /* ... */ } } } },
      401: { description: 'Unauthorized' },
    },
  },
})

export default defineEventHandler(async (event) => {
  /* ... */
})
```

**Minimum required fields**: `openAPI.summary` + `openAPI.responses`。`tags` / `parameters` 建議但非強制。

### Internal endpoint 排除

以下路徑屬內部 endpoint，**MUST NOT** 暴露到 OpenAPI spec、**MUST NOT** 被要求宣告 `defineRouteMeta`：

- `server/api/webhooks/**` — 第三方 webhook，HMAC 驗證
- `server/api/_cron/**` — 內部排程
- `server/api/_evlog/**` — evlog client transport ingest
- `server/api/mcp/**` — MCP endpoint（Bearer token）
- `server/api/_dev/**` — dev-only

Guard / convention 文件**必須**列出相同的排除清單；修改 exclusion 列表時兩端同步更新。

### Guard wiring

Consumer 端 **MUST** 寫一支 `scripts/check-route-meta.ts`（仿 `scripts/check-api-logging.ts` 模式），規則：

- Default 全 scan covered handlers；`--staged` 模式只檢查 staged covered files
- 每個 covered handler **MUST** 含 `defineRouteMeta({ openAPI: { ... } })`、`summary`、`responses`
- 排除 internal endpoint paths（見上節）
- Violation → 列 offending file path + missing field、exit non-zero

Wire 入口：

```jsonc
// package.json
{
  "scripts": {
    "check:route-meta": "node --experimental-strip-types scripts/check-route-meta.ts",
    "check": "vp check && vp run typecheck && pnpm check:api-logging && pnpm check:nuxt-imports && pnpm check:route-meta"
  }
}
```

- `pnpm check` append `&& pnpm check:route-meta`
- `.husky/pre-commit` 加 `bash scripts/pre-commit/checks/route-meta-staged.sh`（staged mode）
- `.github/workflows/_ci-reusable.yml` 加 `vp run check:route-meta` step（跟其他 check 同列）

### Production exposure deny

OpenAPI endpoint **MUST** 只在 dev 暴露，production deny：

```ts
// packages/core/server/middleware/_nitro-prod-deny.ts
export default defineEventHandler((event) => {
  if (import.meta.dev) return
  const url = getRequestURL(event)
  if (url.pathname.startsWith('/_nitro/')) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
})
```

`import.meta.dev` 是 build-time constant，nitro 在 production bundle inline 成 `false` — middleware 永遠走 deny 分支，無 runtime branch。

> **不要**用 `routeRules` deny — routeRules 無法乾淨表達 deny + body semantic（會回 304 / 308 等怪 status）；middleware 配 `import.meta.dev` 是唯一乾淨路徑。

### Default OpenAPI route 重 mount

Nitro 預設 OpenAPI endpoint 是 `/_openapi.json` / `/_scalar` / `/_swagger`，但 production deny middleware 用 `/_nitro/**` prefix 比較乾淨。**MUST** 用 `nuxt.config.ts` 內 `nitro.openAPI.route` / `nitro.openAPI.ui.scalar.route` / `nitro.openAPI.ui.swagger.route` 把 path 改 mount 到 `/_nitro/*` namespace：

```ts
// nuxt.config.ts
nitro: {
  experimental: { openAPI: true },
  openAPI: {
    route: '/_nitro/openapi.json',
    ui: {
      scalar: { route: '/_nitro/scalar' },
      swagger: { route: '/_nitro/swagger' },
    },
  },
}
```

## Runtime 環境差異

Template 預設部署到 **Cloudflare Workers**（`nitro.preset: 'cloudflare_module'`），但可切換到其他目標。各 runtime 的 API handler 限制：

| Runtime            | CPU 時間    | 記憶體  | Node API 相容性   |
| ------------------ | ----------- | ------- | ----------------- |
| Cloudflare Workers | 30 秒上限   | 128MB   | Web Standard 為主 |
| Vercel Serverless  | 60-300 秒   | 1-3GB   | Node.js 完整      |
| Nuxt Hub           | 30 秒（CF） | 128MB   | Web Standard 為主 |
| Self-hosted Node   | 無上限      | host 限 | Node.js 完整      |

### 通用規則（不論 runtime）

- **NEVER** 用 `setInterval` / `setTimeout` 做背景工作 — handler 執行完就退場
- **NEVER** 共用跨 request 的 module-level state（無 persistent process 假設）
- **MUST** 用 Web Standard API（`fetch`, `Response`, `crypto.subtle`）保持可移植

### Workers 專屬注意

- **30 秒 CPU 時間上限** — 長任務必須分批或改用 Queue / Cron Trigger
- **128MB 記憶體上限** — 大檔處理 / 圖片轉換不可在 handler 內跑（改用 R2 + Image Resizing）
- **無 `fs` / `net` / persistent socket** — 所有 IO 都要走 fetch / Supabase HTTP client
- **NEVER** 用 Node.js-only API（`Buffer`, `process.env` 部分、`fs`）— 改用 Web Standard API
- **Env 存取**：透過 `useRuntimeConfig()` 或 `event.context.cloudflare.env`，**NEVER** 用 `process.env`

## Audit Logs

Audit table 命名、欄位、hash chain、RLS、helper 統一規約見：

- **通用 D-pattern**：`db-schema/supabase/audit-schema.md`（<consumer-a> / yuntech / agentic-rag 用 `audit_logs` 表）
- **<consumer-b> legacy**：`db-schema/supabase-self-hosted/audit-schema.md`（<consumer-b> 用 `tdms.operation_logs`）

Runtime module 不重複定義 schema；session agent 從 `db-schema/<variant>/audit-schema.md` 找完整規約。

<!-- requires-module: db-schema -->

## Idempotency 與 Retry

### 需要冪等保證的情境

- 金額、扣庫存、送通知等**副作用不可重複**的操作
- 外部系統整合（email、webhook、push notification）
- 批次匯入（使用者按兩下）

### 實作模式

1. **Unique constraint + ON CONFLICT**：最簡單，利用 DB 層冪等
2. **Client 傳 `idempotency_key`**（UUID）— 對外 API 採用；server 驗證 + 去重
3. **Request-level dedup**：同一 user + 同一 action 短時間內去重

### Retry 策略

| 錯誤類型                         | 可 retry？ | 做法                             |
| -------------------------------- | ---------- | -------------------------------- |
| `40001`（serialization_failure） | ✅         | 最多 3 次，backoff 100/200/400ms |
| `40P01`（deadlock）              | ✅         | 同上                             |
| `PGRST003`（pool timeout）       | ⚠️         | Pool 問題，retry 只會加重負擔    |
| Network timeout                  | ✅         | 但必須有 idempotency 保證        |
| 4xx user error                   | ❌         | 修輸入，不 retry                 |
| 5xx server error                 | ⚠️         | 只 retry 明確無副作用的 GET      |

**NEVER** 對 POST/PATCH/DELETE 做 blind retry — 必須確認有 unique constraint、idempotency_key、或整個 handler 可重跑。

### supabase-js 內建 retry

`@supabase/supabase-js` 對 network error 有內建 retry — 不需自己在 handler 額外包 retry wrapper。
