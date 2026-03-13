## Why

目前 `supabase/migrations/` 是空的。使用者無法參考 migration、RLS policy、database function 的寫法。TDMS 有 100+ migrations，但 starter 連一個範例都沒有。需要提供一個典型的 users/profiles 範例，展示所有 database pattern。

## What Changes

### Demo（clean 版清空 migrations，保留空白 database.types.ts）

- 建立 migration：`profiles` table
  - `id uuid PRIMARY KEY REFERENCES auth.users(id)`
  - `display_name text`
  - `avatar_url text`
  - `role text NOT NULL DEFAULT 'user'` (enum: admin, user)
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `updated_at timestamptz`
  - 適當 indexes
  - `COMMENT ON TABLE / COLUMN` 中文註解
- 建立 RLS policies：
  - `profiles_service_role_all`: service_role bypass
  - `profiles_select_own`: 使用者可讀取自己的 profile
  - `profiles_update_own`: 使用者可更新自己的 profile
  - `profiles_admin_select_all`: admin 可讀取所有 profile
- 建立 database function：
  - `public.set_app_context(p_user_id uuid, p_user_role text)` — 設定 application context 供 RLS 使用
  - `public.handle_updated_at()` — trigger function 自動更新 `updated_at`
  - 所有 function 使用 `SET search_path = ''`
- 建立 `supabase/seed.sql`：開發用種子資料（2-3 個測試 profile）
- 更新 `app/types/database.types.ts`：`supabase gen types` 產出

## Capabilities

### New Capabilities

- `profiles-table`: Users profile 表，展示 migration + RLS + trigger 完整 pattern
- `app-context-rpc`: Application context RPC function，供 server-side RLS 使用
- `seed-data`: 開發環境種子資料

### Modified Capabilities

(none)

## Impact

- 新增 `supabase/migrations/YYYYMMDDHHMMSS_create_profiles.sql` (demo)
- 新增 `supabase/seed.sql` (demo)
- 更新 `app/types/database.types.ts` (demo, clean 版重設為空白)
- **Migration required**: 需執行 `supabase db reset` → `db lint` → `gen types`
- 依賴：無
