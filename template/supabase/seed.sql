-- =============================================================================
-- Seed Data：開發環境測試資料
-- 說明：建立測試用 auth users 與對應的 profiles
-- =============================================================================

-- 建立測試用 auth users（使用 Supabase 內建 auth schema）
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, raw_app_meta_data, raw_user_meta_data)
VALUES
  (
    'a1111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin@example.com',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    now(),
    '',
    '{"provider": "email", "providers": ["email"]}',
    '{}'
  ),
  (
    'b2222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'user1@example.com',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    now(),
    '',
    '{"provider": "email", "providers": ["email"]}',
    '{}'
  ),
  (
    'c3333333-3333-3333-3333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'user2@example.com',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    now(),
    '',
    '{"provider": "email", "providers": ["email"]}',
    '{}'
  )
ON CONFLICT (id) DO NOTHING;

-- 建立對應的 identities（Supabase Auth 需要）
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES
  (
    'a1111111-1111-1111-1111-111111111111',
    'a1111111-1111-1111-1111-111111111111',
    'admin@example.com',
    '{"sub": "a1111111-1111-1111-1111-111111111111", "email": "admin@example.com"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    'b2222222-2222-2222-2222-222222222222',
    'b2222222-2222-2222-2222-222222222222',
    'user1@example.com',
    '{"sub": "b2222222-2222-2222-2222-222222222222", "email": "user1@example.com"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    'c3333333-3333-3333-3333-333333333333',
    'c3333333-3333-3333-3333-333333333333',
    'user2@example.com',
    '{"sub": "c3333333-3333-3333-3333-333333333333", "email": "user2@example.com"}',
    'email',
    now(),
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

-- 建立 profiles 種子資料
INSERT INTO public.profiles (id, display_name, avatar_url, role)
VALUES
  ('a1111111-1111-1111-1111-111111111111', '管理員', 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin', 'admin'),
  ('b2222222-2222-2222-2222-222222222222', '測試使用者一', 'https://api.dicebear.com/7.x/avataaars/svg?seed=user1', 'user'),
  ('c3333333-3333-3333-3333-333333333333', '測試使用者二', 'https://api.dicebear.com/7.x/avataaars/svg?seed=user2', 'user')
ON CONFLICT (id) DO NOTHING;
