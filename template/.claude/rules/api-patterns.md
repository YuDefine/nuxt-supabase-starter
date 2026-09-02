---
description: Server API 設計規範
paths: ["server/api/**/*.ts", "packages/*/server/api/**/*.ts"]
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/runtime/cf-workers/api-patterns.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# API Patterns

**MUST** define request/response contracts in `shared/schemas/*` and derive exported types from the same module
**MUST** use Zod validation for all API inputs — `getValidatedQuery(event, schema.parse)` / `readValidatedBody(event, schema.parse)`
**MUST** call `requireAuth()` or `requireRole()` before any business logic
**MUST** use `getSupabaseWithContext(event)` for request-scoped database access
> **Helper 名依 `modules.auth` 而異**：本檔以 `getSupabaseWithContext(event)` 為 canonical 名。當 consumer 的 `.claude/hub.json` `modules.auth` 是 `better-auth` 或 `nuxt-auth-utils` 時，等價 helper 是 **`getAuthedSupabase(event)`** —— 那些 auth stack 下 Supabase 不簽 JWT，`auth.uid()` 恆 null，helper 只驗 session 不做授權，名字必須說實話。兩者回傳形狀相同（`{ client, user }`）。見 [[auth-data-path-consistency]] § Server 側：RLS policy 的前提條件。
**MUST** parse outgoing handler payloads with response schema `parse()` before returning
**NEVER** use `getServerSupabaseClient()` as the default path in request handlers — reserve it for privileged system tasks
**MUST** log mutations to audit table — 表名與欄位慣例見 `db-schema/<variant>/audit-schema.md`
**MUST** use unified response format `{ data, pagination? }`
**NEVER** return raw database errors to client — use `handleDbError()` + `createError()` with user-friendly message
**MUST** `const log = useLogger(event)` as first line — see `logging.md` for evlog patterns

Reference: `docs/api/API_DESIGN_GUIDE.md` — 完整 API 設計指南含進階模式

> 本檔是 clade 投影，**NEVER** 就地編輯。專案特化寫進自家 `.claude/rules/local/`；要改本檔請回 clade 源檔並 propagate。

## OWASP API Authorization

`requireAuth()` / `requireRole()`（垂直權限）**不足以**擋 OWASP API Top 10 的授權類風險 — 一個 `authenticated` 使用者仍可能存取**別人的**物件、寫入**不該由 client 設定的欄位**、或濫用端點。每個 **state-changing / 敏感讀取** endpoint **MUST** 同時具備 authz + input-shape + abuse-control 三層：

### Authz 層

- **Object-level authorization（BOLA / IDOR）**：**MUST** 對 request 帶的每個 resource id（`:id`、body 內 `targetId` 等）驗證**當前使用者是否真的有權存取該筆 row**（ownership / tenant / role scope），**NEVER** 只因為 id 存在就回傳 / 修改。做法：查詢時把 scope 條件放進 WHERE（`.eq('tenant_id', user.tenantId)` / `.eq('owner_id', user.id)`），或先 fetch 再比對再操作。BOLA 是最常見的 API 漏洞 — `requireAuth()` 過了不代表這個 user 能碰**這筆** row。
- **Property-level authorization（BOPLA / mass assignment）**：**MUST** 用**明確的欄位 allowlist** 決定使用者能讀 / 寫哪些欄位，**NEVER** 直接把 `readBody()` 整包 spread 進 `.update()` / `.insert()`（`update({ ...body })`）。做法：Zod schema 只 `.pick()` 允許的欄位，或手動列 `{ title: body.title, note: body.note }`。防止使用者偷塞 `role` / `is_admin` / `tenant_id` / `price` / `status` 等**不該由 client 設定**的欄位（mass assignment），也防止 response 回傳不該給該 role 看的欄位（over-exposure）。

### Input-shape 層

- **Request body size limit**：**MUST** 對 body 設大小上限（Nitro `routeRules` maxBodySize 或 handler 內檢查 `content-length`），**NEVER** 讓端點無限接收 payload（memory exhaustion / DoS）。大檔上傳走 Storage signed upload（見 `db-runtime/*/database.md`），不經 JSON body。
- **Zod 驗證所有輸入**（已在上方 MUST）— schema 同時是 input-shape gate 與 BOPLA allowlist。

### Abuse-control 層

- **Rate limit**：**MUST** 對敏感 / 昂貴 / 可濫用端點（登入、OTP、密碼重設、匯出、寫入類）設 rate limit（per-user + per-IP），**NEVER** 讓 auth / mutation 端點無限呼叫（暴力破解 / 資源耗盡）。可用 `nuxt-security` rateLimiter 或自管 counter。
- **Quota 分母 MUST 可回落**：**每一個**以「目前有幾個 X」當上限的配額（storage 前綴物件數、DB row count、KV key 數），設定前 **MUST** 回答「被計數的 X，在使用者走完正常流程之後會不會消失或被排除？」——會（session 過期 / 暫存 row 被刪 / job 完成出隊）才可直接計數；不會（被業務 row 引用後留在原地 / audit row 永久保留 / 已完成訂單）**MUST** 改用時間窗、狀態排除、或在正常流程結束時回收該資源。分母只增不減的配額，量到的是**累計使用量**而非濫用強度，正常使用者用到第 N 次就永久 429 —— 加了這種配額比不加更糟（不加只是累積 orphan，加了是功能在正常路徑上壞掉）。**MUST** 補 regression test 釘住「正常流程結束後仍可繼續操作」。三種修法與實作細節（Storage `list()` 的 `sortBy` 必須顯式、`limit` 要放大於配額）見 `~/offline/clade/docs/pitfalls/2026-07-26-quota-counts-unreclaimed-resource.md`。
- **CSRF protection**：對 **browser-origin 的 state-changing 請求**（cookie/session 認證的 POST/PATCH/DELETE）**MUST** 有 CSRF 防護（`nuxt-csurf` double-submit token、或 SameSite=strict/lax cookie + origin 檢查），**NEVER** 只靠 session cookie 就信任跨站來的 mutation。純 token（Authorization header）認證的 API 不受 CSRF 影響，但 cookie-based 一定要防。

**判斷準則**：寫任何 state-changing endpoint 時逐條問 — 「這個 id 是**這個** user 的嗎（BOLA）？」「body 有沒有不該讓 client 設的欄位（BOPLA）？」「body 會不會太大（size）？」「這端點會不會被刷（rate limit）？」「設了配額的話，分母會不會回落（quota）？」「是 cookie 認證的 browser mutation 嗎（CSRF）？」

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

## Mutation 語意完整性

本節管的是「**請求成功了，但沒做到使用者以為的事**」——三條都不會 throw、不進 error log，前端收到 2xx 後顯示「已儲存 / 已套用」，實際狀態與畫面分歧。

### Partial update NEVER 用 truthy 判斷欄位有沒有提供

**每一個** partial update handler（PATCH / 局部 PUT）都 **MUST** 用「**該 key 是否存在於 payload**」決定要不要寫，**NEVER** 用該值的 truthiness。

`if (body.note) updates.note = body.note` 會吞掉 `''`、`0`、`false` —— 使用者「清空備註」「把數量改成 0」「把開關關掉」全部靜默失效，而 handler 回 200、前端顯示已儲存，重新整理才會發現什麼都沒變。

```ts
// ❌ 清空欄位靜默失效
if (body.note) updates.note = body.note

// ✅ 存在性判斷
if ('note' in body) updates.note = body.note
// ✅ 或讓 Zod 承擔：.partial() 後未提供的 key 本來就不在物件裡
const updates = UpdateSchema.partial().parse(body)
```

**NEVER** 用「反正前端一定會帶完整物件」當理由跳過 —— 那把契約押在呼叫端，而 API 的其他呼叫端（行動裝置、腳本、未來的自己）不受那個假設約束。

**每一個**含可清空欄位的 handler 都 **MUST** 有一條 regression test 斷言「送 `''` 之後讀回來是 `''`」，不是只對其中一支補。

### 未知 query 參數 MUST 回 400，NEVER 靜默忽略

**每一個**接受 query string 的 handler 的 Zod schema 都 **MUST** 加 `.strict()`。

靜默忽略未知 key 時，前端把 `?status=active` 打錯成 `?state=active`，後端回的是**未過濾**的完整清單，而前端 filter UI 顯示「已套用」。使用者拿到一份宣稱過濾過、實際沒有的資料 —— 這比回 400 嚴重，因為 400 至少看得見。

```ts
// ❌ 未知 key 被丟掉，錯字無聲
const q = await getValidatedQuery(event, z.object({ status: z.string().optional() }).parse)

// ✅ 未知 key → ZodError → 400
const q = await getValidatedQuery(event, z.object({ status: z.string().optional() }).strict().parse)
```

確定要接受的附加參數（分頁、追蹤參數）**MUST** 逐個寫進 schema 當 optional 欄位，**NEVER** 為了放行它們而拿掉 `.strict()` —— 那等於放行整個未知集合。

### 業務期限 / 數量上限 MUST 在 server 擋

前端的 `max` / `min` / `disabled` / 日期選擇器範圍 **NEVER** 構成 gate —— 它們是提示，不是約束。

**每一條**寫進產品規格的業務上限（試用天數、方案額度、單筆數量上限、有效期限、可選日期範圍）都 **MUST** 在 server handler 內驗證，即使前端已經擋過。繞過不需要任何攻擊技巧：改 DevTools、直接打 API、用舊版前端快取、時區讓邊界日期偏一天。

實際形狀是「規格寫上限 N，資料庫裡有一筆是 N 的數倍，而 server 從來沒檢查過」—— 沒有任何一次請求失敗過，所以也沒有任何訊號。

**Zod schema 是最短的落點**：`z.number().int().max(N)`、`z.coerce.date().refine(d => diffDays(now, d) <= N)`。**NEVER** 把這類檢查只寫在前端 composable。

> **字串長度**那一半不在本條 —— 見 `framework/nuxt/nuxt-form-validation.md` § maxlength（UI truncate 與後端 validation 的一致性）。本條只管日期 / 時長 / 數值的**業務規則**上限。

### 稽核

```bash
node scripts/audit-mutation-semantics.ts    # warn-only
```

**觸發條件**：informational — 不觸發任何東西。命中 **NOT** 等於違規：欄位若是 NOT NULL 且業務上不可清空，truthy 與存在性判斷等價；逐筆判讀是人的工作。

**消費端**：clade 主線 fleet 稽核（`pnpm audit:manual`）、consumer 主線由本檔 `paths` gate 載入後自行對照。

它只量得到前兩條的形狀。**第三條（業務上限 MUST server 擋）本 script 零訊號** —— 上限值本身是業務常數，grep 不出「這個常數有沒有對應的 server 檢查」。**NEVER** 把前兩欄回 0 讀成三條都遵守了。

## Audit Logs

Audit table 命名、欄位、hash chain、RLS、helper 統一規約見：

- **通用 D-pattern**：`db-schema/supabase/audit-schema.md`（<consumer-a> / <consumer-d> / <consumer-c> 用 `audit_logs` 表）
- **<consumer-b> legacy**：`db-schema/supabase-self-hosted/audit-schema.md`（<consumer-b> 用 `<consumer-b>.operation_logs`）

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
