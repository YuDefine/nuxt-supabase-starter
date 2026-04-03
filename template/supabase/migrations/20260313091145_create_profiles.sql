-- =============================================================================
-- Migration: create_profiles
-- 說明：建立 profiles 表、RLS 政策、應用程式 context 函式、updated_at trigger
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Database Functions
-- ---------------------------------------------------------------------------

-- 設定應用程式 context，供 RLS policy 使用（server-side 呼叫）
CREATE OR REPLACE FUNCTION public.set_app_context(
  p_user_id uuid,
  p_user_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('app.user_id', p_user_id::text, true);
  PERFORM set_config('app.user_role', p_user_role, true);
END;
$$;

COMMENT ON FUNCTION public.set_app_context(uuid, text)
  IS '設定應用程式 context（user_id, user_role），供 RLS policy 讀取';

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

CREATE TABLE public.profiles (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
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
COMMENT ON COLUMN public.profiles.id           IS '對應 auth.users(id) 的使用者 UUID';
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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- service_role bypass：所有操作
CREATE POLICY profiles_service_role_all
  ON public.profiles
  FOR ALL
  USING (
    (SELECT auth.role()) = 'service_role'
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
  );

-- 使用者可讀取自己的 profile
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR id::text = current_setting('app.user_id', true)
  );

-- 使用者可更新自己的 profile
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    OR id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    id = auth.uid()
    OR id::text = current_setting('app.user_id', true)
  );

-- admin 可讀取所有 profile
CREATE POLICY profiles_admin_select_all
  ON public.profiles
  FOR SELECT
  USING (
    current_setting('app.user_role', true) = 'admin'
  );
