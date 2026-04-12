---
description: Server API 設計規範
globs: ['server/api/**/*.ts']
---

# API Patterns

**MUST** use Zod validation for all API inputs — `getValidatedQuery(event, schema.parse)` / `readValidatedBody(event, schema.parse)`
**MUST** call `requireAuth()` or `requireRole()` before any business logic
**MUST** use `getSupabaseWithContext(event)` for database access
**MUST** log mutations to `audit_logs` table（action, target_type, target_id, details）— 選用
**MUST** use unified response format `{ data, pagination? }`
**NEVER** return raw database errors to client — use `handleDbError()` + `createError()` with user-friendly message
**MUST** `const log = useLogger(event)` as first line — see `logging.md` for evlog patterns

Reference: `docs/api/API_DESIGN_GUIDE.md` — 完整 API 設計指南含進階模式

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

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

## Audit Logs（選用）

Template **預設未建立** `audit_logs` 表。若專案需要 audit 需求：

1. 建 migration：`public.audit_logs`（uuid PK、user_id、action enum、target_type、target_id、changes JSONB、created_at）
2. RLS：immutable（只 INSERT + SELECT，無 UPDATE / DELETE policy）
3. API handler 在 mutation 成功後插入 log
4. **NEVER** log sensitive 欄位（密碼、token、PII）
5. 建表後更新本檔，把本段改為具體欄位規約

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
