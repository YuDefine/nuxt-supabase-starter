# Supabase Local Workspace

這個目錄存放本地 Supabase 相關資產：

- migrations/: 由 `supabase migration new <name>` 產生的 migration 檔案。
- backups/: 由 `pnpm db:backup` 產生的資料備份檔案。

注意：

1. 不要手動建立 migration SQL 檔案，請使用 Supabase CLI 指令產生。
2. 建立 migration 後，請依序執行：
   - `pnpm db:reset`
   - `pnpm db:lint`
   - `pnpm db:types`
