---
description: 錯誤處理規範（Server 驗證 + Client 顯示）
globs: ['app/**/*.{vue,ts}', 'server/**/*.ts']
---

# Error Handling

**Server-side 驗證**：使用 Zod schema 驗證請求資料，錯誤回傳 `statusMessage`
**NEVER** 在 `createError()` 中傳遞 `data` 屬性 — 可能洩漏內部錯誤細節

**Client-side 錯誤顯示**：使用 `toastError(title, error)` 或 `getErrorMessage(error, fallback)`
**NEVER** 直接讀取 `error.message` 顯示給使用者 — 可能包含堆疊追蹤或內部資訊

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## PostgREST 錯誤碼診斷

Supabase REST API 錯誤分兩層：**Postgres error code**（`23503` 等）與 **PostgREST code**（`PGRSTxxx`），都在 error object 的 `code` 欄位。

### 常見 Postgres error codes

| Code    | HTTP      | 情境                    | 處理方式                                      |
| ------- | --------- | ----------------------- | --------------------------------------------- |
| `23503` | 409       | Foreign key violation   | 回傳「關聯資料不存在或被他處引用」            |
| `23505` | 409       | Unique violation        | 回傳「資料已存在」+ 指出衝突欄位              |
| `42501` | 401 / 403 | Insufficient privileges | 通常是 RLS 擋住 — 檢查 policy + `auth.role()` |
| `42P01` | 404       | Undefined table         | schema / 名稱錯誤或 schema cache 過期         |
| `42883` | 404       | Undefined function      | RPC 函數簽名變更後未 reload schema            |
| `P0001` | 400       | `RAISE EXCEPTION`       | 業務邏輯錯誤，從 detail/hint 取訊息           |
| `40001` | 500       | Serialization failure   | Retry transaction（見 `api-patterns.md`）     |

### 常見 PostgREST API codes

| Code       | HTTP | 情境                         | 處理方式                              |
| ---------- | ---- | ---------------------------- | ------------------------------------- |
| `PGRST000` | 503  | 連不到 DB                    | 告警，檢查 Postgres / Supavisor 狀態  |
| `PGRST003` | 504  | 等 PostgREST pool 超時       | Pool 滿了，檢查 idle connection       |
| `PGRST116` | 406  | `.single()` 取到 0 或 >1 筆  | **預期**的 404 情境，不要 `log.error` |
| `PGRST200` | 400  | Foreign key / embed 關聯失效 | Schema cache 過期，通常會自動恢復     |
| `PGRST202` | 404  | RPC 函數簽名過期             | Reload schema cache                   |
| `PGRST204` | 400  | `columns=` 指定的欄位不存在  | 前端或 type 與 schema 不同步          |
| `PGRST205` | 404  | URI 指定的表不存在           | 同上                                  |
| `PGRST301` | 401  | JWT 無法解碼                 | Client 需重新登入                     |

### 處理原則

- **4xx 是 caller 的錯**（user input / stale type）→ 不要 `log.error`，轉友善訊息即可
- **5xx / 503 / 504 是系統問題** → `log.error` + 告警；`PGRST003` 代表 pool 耗盡，事故級
- **`PGRST116` 特別注意** — `.single()` 查不到資料時拋的是 `PGRST116`（406），不是 404；handler 應轉為 `createError({ status: 404 })` 後再丟出，**禁止** 寫 `log.error`
- **`42501` 出現在 API 回應** → 代表 RLS 擋住且沒有對應 bypass；檢查 server 是否用 `getSupabaseWithContext()` 以及 policy 的 `auth.role() = 'service_role'` 條件
