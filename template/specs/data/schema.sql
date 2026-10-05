-- physical schema 投影（supabase/migrations 回放後的 DB），給 SpecFormula
-- EntityDdlReader 讀的產物，不是 truth；資料模型的 truth 是 specs/truth/data/*.dbml。
-- NEVER 把本檔 psql 套進 DB —— schema 只從 supabase/migrations/*.sql 來。
-- 一致性由 CI 的 specformula DDL check 對回放後的 DB 比對。
-- 對應 migration：supabase/migrations/20260313091145_create_profiles.sql

CREATE TABLE IF NOT EXISTS profiles (
    id          UUID PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar_url  TEXT,
    role        TEXT NOT NULL DEFAULT 'user'
                CHECK (role IN ('admin', 'user')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ
);
