---
description: Server API 設計規範
paths: ["server/api/**/*.ts", "packages/*/server/api/**/*.ts"]
---
<!-- Clade native rule; source: rules/modules/runtime/cf-workers/api-patterns.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# API Patterns

**MUST** define request/response contracts in `shared/schemas/*` and derive exported types from the same module
**MUST** use Zod validation for all API inputs — `getValidatedQuery(event, schema.parse)` / `readValidatedBody(event, schema.parse)`
**MUST** call `requireAuth()` or `requireRole()` before any business logic
**MUST** use `getSupabaseWithContext(event)` for request-scoped database access
> **Helper 名依 `modules.auth` 而異**：本檔以 `getSupabaseWithContext(event)` 為 canonical 名。當 consumer manifest（`.clade/manifest.json`）的 `modules.auth` 是 `better-auth` 或 `nuxt-auth-utils` 時，等價 helper 是 **`getAuthedSupabase(event)`** —— 那些 auth stack 下 Supabase 不簽 JWT，`auth.uid()` 恆 null，helper 只驗 session 不做授權，名字必須說實話。兩者回傳形狀相同（`{ client, user }`）。見 [[auth-data-path-consistency]] § Server 側：RLS policy 的前提條件。
**MUST** parse outgoing handler payloads with response schema `parse()` before returning
**NEVER** use `getServerSupabaseClient()` as the default path in request handlers — reserve it for privileged system tasks
**MUST** log mutations to audit table — 表名與欄位慣例見 `db-schema/<variant>/audit-schema.md`
**MUST** use unified response format `{ data, pagination? }`
**NEVER** return raw database errors to client — use `handleDbError()` + `createError()` with user-friendly message
**MUST** `const log = useLogger(event)` as first line — see `logging.md` for evlog patterns

Reference: `docs/api/API_DESIGN_GUIDE.md` — 完整 API 設計指南含進階模式

> 本檔是 clade 投影，**NEVER** 就地編輯。專案特化寫進自家 `.claude/rules/local/`；要改本檔請回 clade 源檔並 propagate。

## 授權、Mutation 語意、冪等與 Retry

授權（BOLA／BOPLA／rate limit／CSRF／webhook 驗簽）、Mutation 語意完整性、Idempotency 與 Retry 三段在共用規則 `framework/nuxt/api-handler-semantics.md`（兩種 runtime 同一份，本檔不再內嵌）。

## OpenAPI Metadata Convention

**每一個** Nitro API handler 的第一個 executable statement **MUST** 建立 request logger；**每一個**公開 v1 verb-suffix handler（`packages/*/server/api/v1/**/*.{get,post,patch,delete,put}.ts` 等）都 **MUST** 在 module scope 宣告 `defineRouteMeta({ openAPI: { ... } })`，且 `openAPI` **MUST** 同時包含 `summary` 與 `responses`（開 `nitro.experimental.openAPI` 時缺 metadata 容易 cascade 出 `spawn EBADF`）。`webhooks`、`_cron`、`_evlog`、`mcp`、`_dev` internal segments **MUST NOT** 暴露到 OpenAPI、也不要求宣告。

Mechanical checker 是 clade 散播到 consumer 的 `vendor/scripts/check-api-logging.ts` 與 `vendor/scripts/check-route-meta.ts`（上游 SoT 在 clade 同路徑），**NEVER** 自寫第二份。Consumer **MUST** 呼叫 repo 內這份 vendored 路徑（**NEVER** 寫 `~/offline/clade/…`：CI runner 上沒有這個目錄），以實際 server API roots 呼叫並接進 canonical `pnpm check`（單體 repo 省略 roots 預設 `server/api`；monorepo 逐一傳 `packages/<name>/server/api/v1`）。`check:route-meta` 另要接 `.husky/pre-commit`（staged mode）與 `.github/workflows/_ci-reusable.yml` 的獨立 step（與其他 check 同列）——CI 不跑 `pnpm check`，少了這步 CI 就沒有覆蓋。

### Production exposure deny

OpenAPI endpoint **MUST** 只在 dev 暴露。把 route mount 到 `/_nitro/*`，再用 middleware 以 build-time constant `import.meta.dev` deny（**不要**用 `routeRules` deny，會回 304 / 308 等怪 status）：

```ts
// nuxt.config.ts
nitro: {
  experimental: { openAPI: true },
  openAPI: {
    route: '/_nitro/openapi.json',
    ui: { scalar: { route: '/_nitro/scalar' }, swagger: { route: '/_nitro/swagger' } },
  },
}

// packages/core/server/middleware/_nitro-prod-deny.ts
export default defineEventHandler((event) => {
  if (import.meta.dev) return
  if (getRequestURL(event).pathname.startsWith('/_nitro/')) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
})
```

## Runtime 環境差異

Template 預設部署到 **Cloudflare Workers**（`nitro.preset: 'cloudflare_module'`）。不論 runtime：**NEVER** 用 `setInterval` / `setTimeout` 做背景工作；**NEVER** 共用跨 request 的 module-level state；**MUST** 用 Web Standard API（`fetch`, `Response`, `crypto.subtle`）。

Workers 專屬：CPU 30 秒上限（長任務改 Queue / Cron Trigger）、記憶體 128MB（大檔 / 圖片轉換改 R2 + Image Resizing）、無 `fs` / `net` / persistent socket；**NEVER** 用 Node.js-only API（`Buffer`、`fs`）；env 透過 `useRuntimeConfig()` 或 `event.context.cloudflare.env`，**NEVER** 用 `process.env`。

## Audit Logs

Audit table 命名、欄位、hash chain、RLS、helper 統一規約見：

- **通用 D-pattern**：`db-schema/supabase/audit-schema.md`（走通用 schema 的 consumer 用 `audit_logs` 表）
- **self-hosted legacy**：`db-schema/supabase-self-hosted/audit-schema.md`（`<consumer>.operation_logs` 形）

Runtime module 不重複定義 schema；session agent 從 `db-schema/<variant>/audit-schema.md` 找完整規約。

<!-- requires-module: db-schema -->
