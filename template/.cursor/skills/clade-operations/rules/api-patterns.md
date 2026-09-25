---
description: Server API 設計規範
paths: ["server/api/**/*.ts", "packages/*/server/api/**/*.ts"]
---
<!-- Clade native rule; source: rules/modules/runtime/cf-workers/api-patterns.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

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

## OWASP API Authorization

`requireAuth()` / `requireRole()`（垂直權限）**不足以**擋 OWASP API Top 10 的授權類風險。每個 **state-changing / 敏感讀取** endpoint **MUST** 同時具備 authz + input-shape + abuse-control 三層：

### Authz 層

- **Object-level authorization（BOLA / IDOR）**：**MUST** 對 request 帶的每個 resource id（`:id`、body 內 `targetId` 等）驗證當前使用者有權存取**該筆** row（ownership / tenant / role scope），**NEVER** 只因為 id 存在就回傳 / 修改。做法：scope 條件放進 WHERE（`.eq('tenant_id', user.tenantId)` / `.eq('owner_id', user.id)`），或先 fetch 再比對。
- **Property-level authorization（BOPLA / mass assignment）**：**MUST** 用明確的欄位 allowlist 決定可讀 / 可寫欄位，**NEVER** 把 `readBody()` 整包 spread 進 `.update()` / `.insert()`。做法：Zod `.pick()` 或手動列欄位，防止偷塞 `role` / `is_admin` / `tenant_id` / `price` / `status`，也防止 response over-exposure。

### Input-shape 層

- **Request body size limit**：**MUST** 設上限（Nitro `routeRules` maxBodySize 或檢查 `content-length`）；大檔走 Storage signed upload（見 `db-runtime/*/database.md`）。
- **Zod 驗證所有輸入** — schema 同時是 input-shape gate 與 BOPLA allowlist。

### Abuse-control 層

- **Rate limit**：**MUST** 對敏感 / 昂貴 / 可濫用端點（登入、OTP、密碼重設、匯出、寫入類）設 per-user + per-IP rate limit（`nuxt-security` rateLimiter 或自管 counter）。
- **Quota 分母 MUST 可回落**：**每一個**以「目前有幾個 X」當上限的配額（storage 物件數、row count、KV key 數），設定前 **MUST** 回答「X 在正常流程結束後會不會消失或被排除？」——不會（被業務 row 引用、audit 永久保留、已完成訂單）就 **MUST** 改用時間窗、狀態排除，或在流程結束時回收，否則正常使用者用到第 N 次就永久 429。**MUST** 補 regression test 釘住「正常流程結束後仍可繼續操作」。修法細節見 `~/offline/clade/docs/pitfalls/2026-07-26-quota-counts-unreclaimed-resource.md`。
- **CSRF protection**：cookie/session 認證的 browser-origin POST/PATCH/DELETE **MUST** 有 CSRF 防護（`nuxt-csurf` double-submit、或 SameSite + origin 檢查）；純 Authorization header 認證不受影響。

**判斷準則**：寫 state-changing endpoint 時逐條問 — 這個 id 是**這個** user 的嗎（BOLA）？body 有沒有不該讓 client 設的欄位（BOPLA）？會不會太大？會不會被刷？配額分母會不會回落？是 cookie 認證的 browser mutation 嗎（CSRF）？

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

## Mutation 語意完整性

本節管「**請求成功了，但沒做到使用者以為的事**」——三條都不 throw、前端收到 2xx 顯示已儲存，實際狀態與畫面分歧。

### Partial update NEVER 用 truthy 判斷欄位有沒有提供

**每一個** partial update handler（PATCH / 局部 PUT）都 **MUST** 用「該 key 是否存在於 payload」決定要不要寫，**NEVER** 用 truthiness（`if (body.note)` 會吞掉 `''`、`0`、`false`）。

```ts
// ❌ 清空欄位靜默失效
if (body.note) updates.note = body.note
// ✅ 存在性判斷，或讓 Zod .partial() 承擔
if ('note' in body) updates.note = body.note
const updates = UpdateSchema.partial().parse(body)
```

**NEVER** 用「前端一定會帶完整物件」當理由跳過。**每一個**含可清空欄位的 handler 都 **MUST** 有 regression test 斷言「送 `''` 之後讀回來是 `''`」。

### 未知 query 參數 MUST 回 400，NEVER 靜默忽略

**每一個**接受 query string 的 handler 的 Zod schema 都 **MUST** 加 `.strict()`（否則 `?state=active` 錯字會回未過濾的完整清單，而 filter UI 顯示已套用）。

```ts
const q = await getValidatedQuery(event, z.object({ status: z.string().optional() }).strict().parse)
```

要接受的附加參數（分頁、追蹤參數）**MUST** 逐個寫進 schema，**NEVER** 為了放行它們拿掉 `.strict()`。

### 業務期限 / 數量上限 MUST 在 server 擋

前端的 `max` / `min` / `disabled` / 日期範圍 **NEVER** 構成 gate。**每一條**寫進產品規格的業務上限（試用天數、方案額度、單筆數量上限、有效期限、可選日期範圍）都 **MUST** 在 server handler 內驗證，最短落點是 Zod（`z.number().int().max(N)`、`z.coerce.date().refine(...)`）。**NEVER** 只寫在前端 composable。字串長度見 `framework/nuxt/nuxt-form-validation.md` § maxlength。

### 稽核

```bash
node scripts/audit-mutation-semantics.ts    # warn-only
```

**觸發條件**：informational — 不觸發任何東西。命中 **NOT** 等於違規（NOT NULL 且不可清空的欄位兩種寫法等價）。

**消費端**：clade 主線 fleet 稽核（`pnpm audit:manual`）、consumer 主線由本檔 `paths` gate 載入後自行對照。

它只量得到前兩條的形狀，**第三條本 script 零訊號**，**NEVER** 把回 0 讀成三條都遵守了。

## Audit Logs

Audit table 命名、欄位、hash chain、RLS、helper 統一規約見：

- **通用 D-pattern**：`db-schema/supabase/audit-schema.md`（<consumer-a> / <consumer-d> / <consumer-c> 用 `audit_logs` 表）
- **<consumer-b> legacy**：`db-schema/supabase-self-hosted/audit-schema.md`（<consumer-b> 用 `<consumer-b>.operation_logs`）

Runtime module 不重複定義 schema；session agent 從 `db-schema/<variant>/audit-schema.md` 找完整規約。

<!-- requires-module: db-schema -->

## Idempotency 與 Retry

需要冪等保證：金額 / 扣庫存 / 送通知等副作用不可重複的操作、外部系統整合（付款、email、webhook）、批次匯入（按兩下）。實作：(1) unique constraint + `ON CONFLICT`（最簡單）；(2) client 傳 `idempotency_key`（UUID），server 驗證去重；(3) 同 user + 同 action 短時間去重。

| 錯誤類型 | 可 retry？ | 做法 |
| --- | --- | --- |
| `40001`（serialization_failure）、`40P01`（deadlock） | ✅ | 最多 3 次，backoff 100/200/400ms |
| `PGRST003`（pool timeout） | ⚠️ | Pool 問題，retry 只會加重負擔 |
| Network timeout | ✅ | 必須有 idempotency 保證 |
| 4xx user error | ❌ | 修輸入 |
| 5xx server error | ⚠️ | 只 retry 明確無副作用的 GET |

**NEVER** 對 POST/PATCH/DELETE 做 blind retry — 必須有 unique constraint、idempotency_key、或整個 handler 可在 transaction 內安全重跑；無法保證就讓使用者手動重試並顯示明確錯誤。`@supabase/supabase-js` 對 network error 已有內建 retry，不需再包一層。
