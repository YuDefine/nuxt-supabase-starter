## Why

Server 端目前只有一個 singleton Supabase client。TDMS 的經驗顯示，production 專案需要：(1) context-aware 的 Supabase client 讓 RLS 正確運作；(2) PG 錯誤碼對應結構化回應；(3) 統一的 API response 型別。沒有這些 utility，每個新專案都要重新摸索相同的 pattern。

## What Changes

### Infrastructure（clean 版保留）

- 擴充 `server/utils/supabase.ts`：
  - 保留現有 `getServerSupabaseClient()`（Service Role Client）
  - 新增 `getSupabaseWithContext(event)`：從 session 取得 user，透過 RPC 設定 application context，回傳 context-aware client + user info
- 建立 `server/utils/db-errors.ts`：
  - PG 錯誤碼對應表（23505 → 409, 23503 → 400 等）
  - `handleDbError(error)` 函式回傳結構化的 `{ statusCode, message, why, fix }`
  - 支援 constraint name → 領域語言訊息的自訂映射
- 建立 `server/utils/api-response.ts`：
  - 統一的分頁回應格式型別
  - `createPaginatedResponse(data, pagination)` helper
  - `requireRole(event, roles[])` 權限檢查 helper
- 建立 `server/utils/validation.ts`：
  - Zod schema 驗證 helper
  - `getValidatedQuery(event, schema)` / `getValidatedBody(event, schema)` wrapper

## Capabilities

### New Capabilities

- `supabase-context-client`: 帶 RLS application context 的 Supabase client
- `db-error-handler`: PostgreSQL 錯誤碼到結構化 API 回應的映射
- `api-response-helpers`: 統一分頁回應 + 權限檢查 utility
- `request-validation`: Zod schema 驗證 wrapper

### Modified Capabilities

(none)

## Impact

- 修改 `server/utils/supabase.ts` (infrastructure)
- 新增 `server/utils/db-errors.ts` (infrastructure)
- 新增 `server/utils/api-response.ts` (infrastructure)
- 新增 `server/utils/validation.ts` (infrastructure)
- 全部為 infrastructure，clean 版保留
- 不需要 migration
