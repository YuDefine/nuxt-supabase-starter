-- =============================================================================
-- Migration: create_audit_logs
-- 說明：建立 audit_logs 表與 deny-all RLS
--
-- 授權模型與 profiles 相同：server-mediated。詳見
-- 20260313091145_create_profiles.sql 的檔頭與 server/utils/supabase.ts 的
-- module JSDoc。
--
-- 這張表先前只存在於 server/utils/audit.ts 的 insert 呼叫裡，沒有對應的
-- migration——寫入必然失敗，而失敗又被 createAuditLog 吞掉（PostgREST 的 DB
-- 錯誤走 resolve 不走 reject），所以從來沒有人發現。
-- =============================================================================

CREATE TABLE public.audit_logs (
  id          bigserial   PRIMARY KEY,
  -- 無 FK：使用者由 Better Auth 管理，不在 Supabase 的 auth.users 裡。
  -- 另外稽核記錄本來就該在使用者刪除後留存，FK + CASCADE 反而是錯的。
  user_id     text,
  action      text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   text        NOT NULL,
  changes     jsonb,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 查詢模式：依實體回溯歷程、依使用者回溯行為、依時間掃最近事件。
CREATE INDEX idx_audit_logs_entity ON public.audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON public.audit_logs (user_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);

COMMENT ON TABLE  public.audit_logs             IS '稽核記錄（append-only，不提供 UPDATE / DELETE 路徑）';
COMMENT ON COLUMN public.audit_logs.user_id     IS '對應 Better Auth 的 user id；系統動作為 NULL';
COMMENT ON COLUMN public.audit_logs.action      IS '動作名稱，例如 create / update / delete';
COMMENT ON COLUMN public.audit_logs.entity_type IS '被操作的實體種類';
COMMENT ON COLUMN public.audit_logs.entity_id   IS '被操作的實體 id';
COMMENT ON COLUMN public.audit_logs.changes     IS '欄位變更前後值';
COMMENT ON COLUMN public.audit_logs.metadata    IS '附加脈絡，例如來源 IP、User-Agent';
COMMENT ON COLUMN public.audit_logs.created_at  IS '記錄建立時間';

-- ---------------------------------------------------------------------------
-- RLS：deny-all by design
-- ---------------------------------------------------------------------------
-- 啟用 RLS 但不建任何 policy — anon 與 authenticated 一律讀寫不到。
-- 寫入由 server 的 service-role 連線負責（具 BYPASSRLS）。
-- 稽核記錄含其他使用者的行為軌跡，本來就不該讓前端直接讀取。
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
