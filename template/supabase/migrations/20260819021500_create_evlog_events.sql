-- =============================================================================
-- Migration: create_evlog_events
-- 說明：建立 evlog wide event 的 queryable durable drain table
--
-- 來源：clade vendor/snippets/evlog-postgres-drain/migration.sql，依本 starter
-- 的授權模型調整（單租戶，移除依租戶過濾的 SELECT policy 與對應專欄；
-- 函數補 SET search_path = ''）。
--
-- 為什麼必須有這張表：clade rules/core/evlog-adoption.md § Drain 選擇指引 —
-- Supabase stack 的 evlog consumer MUST 配一個 queryable durable drain 當事後
-- 鑑識的資料源。Sentry drain 是 alerting / triage 的補充層，它不可查詢、不保留
-- 長尾，替代不了這張表。
-- =============================================================================

CREATE TABLE public.evlog_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ts          timestamptz NOT NULL,
  level       text        NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  service     text,
  environment text,
  method      text,
  path        text,
  status      integer,
  duration_ms integer,
  request_id  text,
  -- 無 FK：使用者身分不在 Supabase 的 auth.users 裡，且事件本來就該在使用者
  -- 刪除後留存（與 audit_logs 同理由）。
  user_id     text,
  source      text,
  error_json  jsonb,
  attributes  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 查詢模式：時間範圍 + level 掃、依 route 找、依使用者回溯、依 request_id 串單一請求。
CREATE INDEX evlog_events_ts_level_idx ON public.evlog_events (ts DESC, level);
CREATE INDEX evlog_events_path_idx ON public.evlog_events (path) WHERE path IS NOT NULL;
CREATE INDEX evlog_events_user_idx ON public.evlog_events (user_id, ts DESC) WHERE user_id IS NOT NULL;
CREATE INDEX evlog_events_request_id_idx ON public.evlog_events (request_id) WHERE request_id IS NOT NULL;

-- attributes JSONB GIN（任意 key 查詢用）預設不開；量大且真的按 attribute 查再加。
-- CREATE INDEX evlog_events_attributes_gin ON public.evlog_events USING gin (attributes);

COMMENT ON TABLE  public.evlog_events             IS 'evlog wide event 的 durable drain（append-only；retention 由 evlog_events_retention 控制）';
COMMENT ON COLUMN public.evlog_events.ts          IS '事件發生的 UTC instant（timestamptz；顯示層自行轉當地時區）';
COMMENT ON COLUMN public.evlog_events.environment IS '部署目標，取自 NUXT_APP_ENV；注入斷掉時為 unknown';
COMMENT ON COLUMN public.evlog_events.attributes  IS '未進專欄的其餘 wide event 欄位；PII 由 evlog redact 在寫入前濾掉';

-- ---------------------------------------------------------------------------
-- RLS：deny-all by design（與 audit_logs 同一個授權模型）
-- ---------------------------------------------------------------------------
-- 啟用 RLS 但不建任何 policy — anon 與 authenticated 一律讀寫不到。
-- drain 走 service-role 連線寫入（具 BYPASSRLS），查詢走 server 端 API 或 SQL console。
-- wide event 含其他使用者的請求軌跡，不該讓前端直接讀取。
--
-- 上游 snippet 另附一條依租戶範圍過濾的 SELECT policy 與一個對應的專欄，本 starter
-- 是單租戶、沒有那個 helper function，依 snippet 的單租戶指示一併移除——留著會是
-- 沒有任何 policy 或程式會寫入的死欄位。多租戶專案請照 clade
-- vendor/snippets/evlog-postgres-drain/ 的原版加回專欄、索引與 policy。
ALTER TABLE public.evlog_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Retention：由 cron 每天呼叫，drop 掉超過保留期的 row
-- ---------------------------------------------------------------------------
-- SET search_path = '' 是本專案對所有函數的硬性要求（見 .vite-hooks/pre-commit），
-- 因此函數體內的所有物件名都必須完整限定。
CREATE OR REPLACE FUNCTION public.evlog_events_retention(retention_days integer DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count bigint;
BEGIN
  DELETE FROM public.evlog_events
  WHERE ts < now() - (retention_days || ' days')::interval;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.evlog_events_retention(integer) IS '刪除 retention_days 天前的 evlog_events，回傳刪除筆數；由 cron 以 service_role 呼叫';

REVOKE ALL ON FUNCTION public.evlog_events_retention(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evlog_events_retention(integer) TO service_role;
