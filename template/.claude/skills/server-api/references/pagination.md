# 分頁與搜尋

分頁、搜尋、排序（含 `sortBy !== 'id'` 時補 `id` tie-breaker）的完整程式碼在 [api-template.md](api-template.md) § GET 列表 API，`PAGE_SIZE_MAX`（定義在 `shared/schemas/pagination.ts`）與 query schema 在同檔 § Zod Schema 定義。

異動操作的稽核日誌走 audit 規約（`rules/core/audit-pattern.md` 的 `audit_logs`；<consumer-b> legacy 的 `operation_logs` 見 `db-schema/supabase-self-hosted/audit-schema.md`），不在此另寫一份。
