-- =============================================================================
-- Migration: create_profiles
-- 說明：建立 profiles 表、deny-all RLS、updated_at trigger
--
-- 授權模型：server-mediated（見 server/utils/supabase.ts 的 module JSDoc）
--   本專案的 auth 是 Better Auth，不是 Supabase Auth——Supabase 從未對本 app 的
--   使用者簽發 JWT，所以 RLS policy 裡的 auth.uid() 恆為 null。server 端也只有
--   service-role 連線（具 BYPASSRLS）。因此 RLS 無法承擔 row-level 授權，那是
--   handler 的責任；這裡的 RLS 只負責「非 server 一律拒絕」。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Database Functions
-- ---------------------------------------------------------------------------

-- 自動更新 updated_at 欄位的 trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_updated_at()
  IS '自動將 updated_at 設為 now()，用於 BEFORE UPDATE trigger';

-- ---------------------------------------------------------------------------
-- 2. Profiles Table
-- ---------------------------------------------------------------------------

-- id 刻意「不」加 FK：使用者由 Better Auth 管理，不在 Supabase 的 auth.users 裡，
-- 跨資料來源無法建立 referential integrity。刪除使用者時要一併清 profile 的責任
-- 因此落在應用層（原本的 ON DELETE CASCADE 從來沒有生效過）。
CREATE TABLE public.profiles (
  id           uuid        PRIMARY KEY,
  display_name text,
  avatar_url   text,
  role         text        NOT NULL DEFAULT 'user'
                           CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'user')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz
);

-- 索引
CREATE INDEX idx_profiles_role ON public.profiles (role);

-- 中文註解
COMMENT ON TABLE  public.profiles              IS '使用者個人資料';
COMMENT ON COLUMN public.profiles.id           IS '對應 Better Auth 的 user id（無 FK，見上方註解）';
COMMENT ON COLUMN public.profiles.display_name IS '顯示名稱';
COMMENT ON COLUMN public.profiles.avatar_url   IS '頭像網址';
COMMENT ON COLUMN public.profiles.role         IS '角色：admin 或 user';
COMMENT ON COLUMN public.profiles.created_at   IS '建立時間';
COMMENT ON COLUMN public.profiles.updated_at   IS '最後更新時間';

-- updated_at trigger
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS Policies
-- ---------------------------------------------------------------------------

-- deny-all by design：啟用 RLS 但**不建立任何 policy**。
--
-- 效果：anon 與 authenticated 兩個角色一律讀寫不到任何 row，即使 publishable key
-- 外流、有人直接打 PostgREST 也拿不到資料。server 端走 service_role 連線，
-- 本身具 BYPASSRLS，不受這裡影響。
--
-- 為什麼不寫 row-level policy：本專案的使用者由 Better Auth 管理，Supabase 沒有
-- 對他們簽發 JWT，auth.uid() 恆為 null；先前用 set_app_context() 塞 app.user_id
-- GUC 的做法也不成立——那是 transaction-local 設定，而 PostgREST 每個 request
-- 是獨立 transaction，GUC 在 RPC 回傳的當下就失效了。兩條路都走不通，所以
-- row-level 授權一律由 handler 負責（requireAuth + ownership 比對 / requireRole）。
--
-- ⚠️ 若日後改用 Supabase Auth（或替 Better Auth session 換發 Supabase JWT），
-- 這裡才有條件加回真正生效的 row-level policy。
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
