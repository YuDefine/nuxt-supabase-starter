---
audience: ai-agent
applies-to: post-scaffold
related:
  - AGENTS.md
  - WORKFLOW.md
  - OPENSPEC.md
purpose: 把常見開發需求（加 entity / 加 page / 加 endpoint / 加 OAuth ...）打包成可直接套用的 spectra-propose 範本，AI 收到使用者描述後直接套用，不必每次重新規劃流程
---

# 開發場景 Recipes

> 使用者描述開發需求時，AI 找對應 recipe → 直接以該 recipe 為基礎跑 `spectra-propose`，把使用者原描述塞進範本的「需求」欄位。每個 recipe 都標出涉及的 skill / rule / 必跑步驟。

## 路由表（使用者描述關鍵字 → recipe）

| 關鍵字                                 | Recipe                                           |
| -------------------------------------- | ------------------------------------------------ |
| 「加一個 X 表 / entity / 資料模型」    | [R1](#r1--加一個-entity含-migration--rls--types) |
| 「加一個 X 列表 / 管理頁面 / CRUD 頁」 | [R2](#r2--加一個-crud-頁面full-stack)            |
| 「加一個 API endpoint / server route」 | [R3](#r3--加一個-server-api-endpoint)            |
| 「加 RLS policy / 權限」               | [R4](#r4--加--改-rls-policy)                     |
| 「加 OAuth / 第三方登入」              | [R5](#r5--加-oauth-provider)                     |
| 「加 webhook / 接收外部事件」          | [R6](#r6--加-webhook-endpoint)                   |
| 「加 cron / 定期任務 / 排程」          | [R7](#r7--加排程任務cron)                        |
| 「整合第三方 API / 外部服務」          | [R8](#r8--整合第三方-api)                        |
| 「加檔案上傳 / 圖片上傳」              | [R9](#r9--加檔案--圖片上傳)                      |
| 「加 email / 通知」                    | [R10](#r10--加-email--通知)                      |
| 「加搜尋 / 全文檢索」                  | [R11](#r11--加搜尋全文檢索-或-pgvector)          |
| 「加多語系 / i18n」                    | [R12](#r12--加多語系-i18n)                       |
| 「加付費 / 訂閱 / Stripe」             | [R13](#r13--加付費--訂閱)                        |
| 「加儀表板 / 圖表 / 分析」             | [R14](#r14--加儀表板--charts)                    |
| 「重構 / 改架構」                      | [R15](#r15--重構--架構調整)                      |

---

## R1 — 加一個 entity（含 migration / RLS / types）

**涉及**：`supabase-migration` skill、`supabase-rls` skill、`.claude/rules/migration.md`、`.claude/rules/rls-policy.md`

**Spectra-propose 範本**：

```
新增 <entity_name> 資料模型，欄位：<list>

Affected Entity Matrix:
  - Entity: <entity_name>
    Columns: id (uuid PK), created_at, updated_at, <fields>...
    Roles: <admin / user / staff>
    Actions: create, read, update, delete, list/filter
    States: empty, loading, error, success, unauthorized
    Surfaces: <admin path / user-facing path>

User Journeys:
  - Admin 在 /<path> 建立新 <entity>，填表單後送出 → 列表看到新建項目
  - User 在 /<path> 看到自己擁有的 <entity> 列表
  - User 編輯自己的 <entity>，儲存後 toast 顯示成功

Implementation Risk Plan:
  - Truth layer: supabase/migrations/ 是 schema 真相；shared/types 派生
  - Review tier: Tier 3（含 migration + RLS）
  - Contract / failure paths: 唯一鍵衝突 409、未授權 401、RLS 拒絕 403
  - Test plan: API integration test + 一條 e2e journey 截圖
  - Artifact sync: app/types/database.types.ts、shared/schemas/<entity>.ts、tasks.md
```

**必跑命令**：

```bash
supabase migration new create_<entity>
# 編輯 supabase/migrations/<timestamp>_create_<entity>.sql
supabase db reset
supabase db lint --level warning
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
pnpm typecheck
```

## R2 — 加一個 CRUD 頁面（full-stack）

**涉及**：`server-api`、`pinia-store`、`nuxt-ui`、`vue`、`vue-best-practices` skills

**前置條件**：對應 entity（R1）已存在或同 change 一併建。

**Spectra-propose 範本**：

```
新增 /<entity_name> 管理頁面，支援列表 / 新增 / 編輯 / 刪除

Affected Entity Matrix:
  - Entity: <entity_name>
    Surfaces:
      - app/pages/<entity>/index.vue（列表）
      - app/pages/<entity>/[id].vue（詳情/編輯）
    Server: server/api/v1/<entity>/index.{get,post}.ts、[id].{get,patch,delete}.ts
    Store: app/stores/<entity>.ts（Pinia + Colada）
    Schema: shared/schemas/<entity>.ts（Zod，request/response 共用）

User Journeys:
  - User 進 /<entity> → 看 list（含 pagination + 搜尋 filter）
  - User 點「新增」→ 開 form → 填寫 → 儲存 → 列表更新
  - User 點某項 → 進詳情 → 編輯 → 儲存
  - User 點刪除 → 確認 dialog → 列表移除

State coverage（必填）：empty / loading / error / unauthorized

Implementation Risk Plan:
  - Truth layer: shared/schemas 是 contract source；UI 不重新定義
  - Review tier: Tier 2
  - Contract: 422 validation / 404 not found / 403 RLS
  - Test plan: e2e 走完一輪 CRUD + screenshot review
  - Artifact sync: navigation 加入口、tasks.md 含 design review block
```

**Design Checkpoint 必跑**：tasks.md 自動加 `## Design Review` block（hook 已處理），執行時：

```bash
# spectra-apply 流程中：
/design improve [<entity>/index.vue, <entity>/[id].vue]
# 依診斷跑 targeted skills (layout / typeset / colorize / harden / clarify)
/impeccable audit
review-screenshot
```

## R3 — 加一個 server API endpoint

**涉及**：`server-api` skill、`.claude/rules/api-patterns.md`、`.claude/rules/logging.md`

**Spectra-propose 範本**：

```
新增 server/api/v1/<resource>/<action>.{method}.ts

Implementation Risk Plan:
  - Contract: 定義 shared/schemas/<resource>.ts 的 request/response Zod schema
  - Auth: requireAuth() / requireRole() 在所有業務邏輯前
  - Database: getSupabaseWithContext(event) — 不用 service role bypass 除非明確系統任務
  - Logging: const log = useLogger(event) 第一行
  - Error: handleDbError() 包裝後 throw createError()，禁止 raw error 給 client
  - Response: response schema parse() 後 return

Test plan:
  - Unit: zod schema 驗證 invalid input 拒絕
  - Integration: hit endpoint with auth + 預期 status code
  - 失敗路徑: 401 unauth / 403 RLS / 404 not found / 422 validation
```

**檢查清單**：見 `API_PATTERNS.md`。

## R4 — 加 / 改 RLS policy

**涉及**：`supabase-rls` skill、`.claude/rules/rls-policy.md`、`.claude/rules/query-optimization.md`

**警告**：RLS 改動 = Tier 3 review。**禁止** 用 MCP execute_sql，必走 migration。

**Spectra-propose 範本**：

```
為 public.<table> 加 RLS policy：<role> 可 <action>

Truth layer / invariants:
  - Policy 必含 (SELECT auth.role()) = 'service_role' bypass
  - UPDATE policy 必須搭配 SELECT policy
  - WHERE 欄位（user_id / org_id）必須有 index
  - 用 (SELECT auth.uid()) 而非 auth.uid() — initPlan 快取

Review tier: Tier 3
Test plan:
  - EXPLAIN ANALYZE 確認 index 走到、無 Seq Scan
  - 模擬不同 role 跑 query，確認應允許 / 拒絕的 case
```

**必跑命令**：

```bash
supabase migration new add_rls_<table>
# 編輯 SQL，policy 命名 <action>_<role>_<table>
supabase db reset
pnpm db:lint
pnpm typecheck
# EXPLAIN ANALYZE 驗證效能（見 query-optimization.md）
```

## R5 — 加 OAuth provider

**涉及**：`nuxt-better-auth` 或 `nuxt-auth-utils` skill、`.claude/rules/auth.md`

**前置條件**：使用者去 provider console 申請 credentials（**AI 不可代填**）。

**Spectra-propose 範本**：

```
加 <Provider> OAuth 登入（Google / GitHub / LINE / Discord / ...）

Affected Entity Matrix:
  - .env: NUXT_OAUTH_<PROVIDER>_CLIENT_ID, NUXT_OAUTH_<PROVIDER>_CLIENT_SECRET
  - .env.example: 同上（註解標 placeholder）
  - app/pages/login.vue: 加 OAuth button
  - server/api/auth/[...]: better-auth 已自動處理 callback

User Journeys:
  - User 點「Sign in with <Provider>」→ 跳 provider 登入 → 回來 callback → session 建立 → 跳轉 dashboard
  - 已登入時點「Sign in」→ 直接跳 dashboard（skip auth）
  - 取消 OAuth → 回 login 頁，無錯誤訊息殘留

Implementation Risk Plan:
  - Provider Console 設定：redirect URI 為 {NUXT_PUBLIC_SITE_URL}/api/auth/callback/<provider>
  - Test plan: 手動 e2e（不能 mock OAuth flow）+ 截圖
  - Artifact sync: docs/auth/ 對應 provider 設定文件
```

**必跑步驟**（AI 引導使用者）：

1. 跑 `pnpm verify:starter` 看缺哪些 NUXT*OAUTH*\* env var
2. 點開 verify-starter 印出的 provider console URL
3. Provider Console 建立 OAuth app，redirect URI 填 `{NUXT_PUBLIC_SITE_URL}/api/auth/callback/<provider>`
4. 取得 Client ID / Secret，填入 `.env`
5. 重啟 `pnpm dev`

## R6 — 加 webhook endpoint

**涉及**：`server-api` skill、`.claude/rules/api-patterns.md`（Idempotency 段）

**Spectra-propose 範本**：

```
接收 <provider> webhook，例：Stripe payment.succeeded、GitHub push

Implementation Risk Plan:
  - Truth layer: webhook payload schema（Zod）
  - Auth: 驗證 signature header（Stripe-Signature / X-Hub-Signature-256）
  - Idempotency: 用 webhook event_id 做 unique constraint，重複時 ON CONFLICT DO NOTHING
  - Retry safety: handler 必須冪等 — provider 可能 retry
  - Logging: 完整 event_id + body 進 evlog（敏感欄位 redact）
  - Failure: 回 200 即使內部處理失敗（避免 provider retry storm）；錯誤寫進 dead letter table

Test plan:
  - Unit: signature 驗證、payload schema 驗證
  - Integration: mock provider request 跑 handler 全程
  - 重複 webhook: 第二次應 idempotent skip
```

## R7 — 加排程任務（cron）

**涉及**：runtime-specific 設定（Cloudflare Workers Cron Trigger / Vercel Cron / pg_cron）

**Decision tree**（依 deploy target）：

| Runtime                | 推薦方案                    | 設定位置                                           |
| ---------------------- | --------------------------- | -------------------------------------------------- |
| Cloudflare Workers     | Workers Cron Trigger        | `wrangler.toml` `[triggers] crons = ["0 * * * *"]` |
| Vercel                 | Vercel Cron                 | `vercel.json` `crons` 欄位                         |
| Self-hosted Node       | systemd timer / cron + curl | infra 設定                                         |
| 必須以 DB state 為中心 | pg_cron + pg_net            | migration 啟用 extension                           |

**Spectra-propose 範本**：

```
排程任務：每 <interval> 跑 <action>

Implementation Risk Plan:
  - Truth layer: 任務的 invariant（例如「處理一次後 status = processed」）
  - Idempotency: 任務必須冪等 — 可能重跑
  - Failure handling: 失敗寫進 cron_runs 表 + alert
  - Timezone: 明確使用 UTC，註解寫當地時間
  - Test plan: 手動觸發 endpoint 跑 cron logic + 跑兩次驗證冪等

Artifact sync: docs/api/<cron>.md、wrangler.toml / vercel.json
```

詳見 `.claude/rules/unused-features.md` Cron 段。

## R8 — 整合第三方 API

**涉及**：`server-api` skill、`.claude/rules/api-patterns.md`

**Spectra-propose 範本**：

```
整合 <vendor>（如 OpenAI / Anthropic / Stripe / Twilio）

Implementation Risk Plan:
  - Secret: API key 放 runtimeConfig（server-only），禁止 NUXT_PUBLIC_*
  - Wrapper: server/utils/<vendor>.ts 統一 client，handle rate limit / retry / timeout
  - Error: vendor 5xx 重試 3 次（exponential backoff）；4xx 直接 throw
  - Cost: log 每次呼叫的 token / cost（若是 LLM API）
  - Edge runtime 限制（若部署 CF Workers）：
    - 不可用 Node-only library（檢查 vendor SDK 是否相容 Web Standard）
    - 30 秒 CPU limit — long generation 用 streaming response

Test plan:
  - Unit: mock fetch 測 wrapper retry / timeout 邏輯
  - Integration: 真打 vendor sandbox（CI 跳過、local 才跑）
```

## R9 — 加檔案 / 圖片上傳

**涉及**：`.claude/rules/storage.md`

**Decision tree**：

| 場景                      | 推薦                                         |
| ------------------------- | -------------------------------------------- |
| 部署到 Cloudflare Workers | R2（無 egress fee、原生整合）                |
| 部署到 Vercel / Node      | Supabase Storage 或 R2                       |
| 需 image transformation   | Supabase Storage（內建）或 Cloudflare Images |
| 大檔（>100MB）+ Workers   | TUS resumable upload 直傳 R2                 |

**Spectra-propose 範本**：

```
新增 <feature> 檔案上傳（圖片 / PDF / ...）

Implementation Risk Plan:
  - 上傳路徑: client → server/api/v1/upload.post.ts（service_role）→ Storage
  - 禁止 client 直傳 Storage（除非 signed URL pattern）
  - 檔名: server 端產生 {entity_id}/{timestamp}-{random}.{ext}，禁信任前端檔名
  - MIME 驗證: server 端檢查 file.type + file.size + bucket 設定 allowed_mime_types
  - Rollback: upload 成功後 DB insert 失敗 → 刪 storage 檔（補救單向 transaction）
  - Bucket policy: INSERT + SELECT + UPDATE 三個 policy（upsert 必備）

Test plan:
  - 上傳 happy path
  - 超過 size limit 應 422
  - 錯誤 MIME 應 422
  - DB rollback 後 Storage 真的清掉
```

## R10 — 加 email / 通知

**涉及**：`resend` skill（如有 Resend 整合）、`server-api`

**Spectra-propose 範本**：

```
寄 <event> 通知信（例：歡迎信 / 訂單確認 / 密碼重設）

Implementation Risk Plan:
  - Provider: Resend / Postmark / AWS SES
  - Idempotency key: 用 entity_id + event_type，避免重寄
  - Template: 用 React Email / MJML / 純 HTML，存在 server/emails/ 或 vendor 後台
  - Webhook: 接收 delivery / bounce / complaint，更新使用者 email_status
  - Test plan: dev 用 vendor sandbox / Inbucket（Supabase 本機）；prod 用真實寄送
```

## R11 — 加搜尋（全文檢索 或 pgvector）

**Decision tree**：

| 場景                   | 推薦                                  |
| ---------------------- | ------------------------------------- |
| 短欄位精確 / LIKE      | B-tree index + ILIKE                  |
| 長文全文搜尋           | tsvector + GIN index                  |
| 語義 / RAG / embedding | pgvector + ivfflat                    |
| 部署到 Workers + RAG   | Cloudflare Vectorize（替代 pgvector） |

**Spectra-propose 範本**：

```
為 <entity> 加搜尋功能

Implementation Risk Plan:
  - Index 類型: <B-tree / GIN tsvector / vector(1536)>
  - Migration: 啟用必要 extension（ext: vector / pg_trgm）
  - Search query: server-side sanitize（用 sanitizePostgrestSearch）— 禁止 raw .or() / .ilike() 拼接
  - UI: debounce 300ms + 顯示 loading state
  - 大資料時 ranking: ts_rank 或 vector cosine

Test plan:
  - 中英文混合 query
  - SQL injection 字元（', %, _）正確 escape
  - 效能: EXPLAIN ANALYZE 確認 index 命中
```

## R12 — 加多語系 i18n

**涉及**：`@nuxtjs/i18n` 或 vue-i18n（看是否已安裝）

**Spectra-propose 範本**：

```
支援多語系（zh-TW / en / ja / ...）

Implementation Risk Plan:
  - Locale 檔案位置: i18n/locales/<lang>.json
  - Routing: prefix_except_default 或 no_prefix（看是否需要 SEO）
  - Date / number: 用 Intl API（自動依 locale）
  - DB 內容多語: 額外欄位 <field>_locale 或單獨 translations 表
  - SSR: 確保 server-side 也載入正確 locale
  - User journeys 測完一輪一個 locale，再切下一個 locale 重測

Artifact sync: app.config 加語言列表、navigation 加 locale switcher
```

## R13 — 加付費 / 訂閱

**涉及**：第三方（Stripe / 綠界 / 藍新）— webhook（R6）+ DB 訂單表（R1）

**Spectra-propose 範本**（Stripe 為例）：

```
整合 Stripe checkout + 訂閱

Implementation Risk Plan:
  - Truth layer: Stripe 是 source of truth；本地 DB 是 cache
  - Webhook idempotency: 必備（見 R6）
  - Critical events: customer.subscription.created / updated / deleted、invoice.paid、charge.failed
  - Test mode vs live: env var STRIPE_MODE 切換 + dev 一律用 test key
  - Test plan: 用 Stripe CLI 觸發 webhook event + 驗證 DB 狀態同步
  - Compliance: 信用卡資料禁止落地（用 Stripe Elements 不要自家 form 收）

Artifact sync: docs/api/stripe-webhook.md、shared/schemas/stripe.ts
```

## R14 — 加儀表板 / charts

**涉及**：`nuxt-charts`（Unovis）、`nuxt-ui`、`pinia-store`

**Spectra-propose 範本**：

```
新增 /<dashboard> 頁，含 <chart-types> 視覺化 <metric>

Affected Entity Matrix:
  - Server: GET /api/v1/analytics/<metric>（可能需要 RPC 聚合）
  - Cache: Pinia Colada staleTime 設合理值（避免每次重抓）
  - UI: charts 用 Unovis；layout 用 grid

Implementation Risk Plan:
  - 大資料聚合: 用 PG RPC 或 materialized view，不要 client-side 算
  - Loading state: skeleton chart 而非 spinner
  - Empty state: 「尚無資料」+ CTA 引導
  - Responsive: chart 在 mobile / desktop 各自最佳化
  - Color: Nuxt UI semantic（color-default / muted / accented），禁 hardcoded

Design Checkpoint: 必跑（chart 類最易出 layout / typography 偏差）
```

## R15 — 重構 / 架構調整

**特殊**：重構 = 不改外部行為的內部優化。**避免**改 spec / API 介面 / DB schema。

**先跑**：

```bash
# 看當前架構
pnpm spectra:roadmap        # 看 active changes 確保不撞工
git log --oneline -20       # 看最近改動 context
```

**Spectra-propose 範本**：

```
重構 <area>：<motivation>

Non-Goals（必填）:
  - 不改 API 行為
  - 不改 DB schema
  - 不改使用者可見功能

Implementation Risk Plan:
  - Review tier: Tier 2（範圍小）/ Tier 3（範圍大跨多模組）
  - Test coverage: 必須先有測試 covers 既有行為，重構後 tests 仍綠
  - 漸進: 大重構分多 PR，每 PR 都可獨立 deploy
  - Test plan: 跑 pnpm check 全綠 + 跑 e2e 確保關鍵 journey 沒壞

Artifact sync: 若改檔位 / 命名，docs 內 forward-link 必須同步更新
```

---

## 多 recipe 合成

使用者描述含多個關鍵字時，AI 應主導合成：

> 「加 e-commerce 訂單系統，含金流、email 通知、後台管理」

→ R1（orders entity）+ R2（admin CRUD page）+ R6（Stripe webhook）+ R8（Stripe API）+ R10（email）

合成 spectra-propose：列為一個大 change（含多個 entity matrix），或拆成多個 change（每個 entity 一個）+ depends-on marker。

> 「重構 auth 換掉 better-auth 改用 nuxt-auth-utils」

→ R15（重構） + R5（OAuth 重設定）+ migration（auth 表清理）

這種 cross-cutting 重構建議：先 spectra-discuss 收斂方向 → 再 propose（含 phase plan）→ apply 分階段。

## 套用 recipe 後的 next-step

每個 recipe 完成 spectra-propose 後：

```bash
# 1. 驗證 proposal 完整性
pnpm spectra:roadmap

# 2. 若 UI scope，跑 design checkpoint
# (spectra-apply 過程會自動觸發)

# 3. 進 spectra-apply 開始實作
# (Claude session 內: /spectra-apply <change>)

# 4. 完成後 archive
# (Claude session 內: /spectra-archive <change>)
```
