-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
-- preset: evlog-d-pattern-audit
-- source: vendor/snippets/evlog-audit-signed/migration.sql
-- to: presets/evlog-d-pattern-audit/supabase/migrations/0001_create_audit_signed_chain.sql
-- do not edit consumer-side; modify clade vendor snippet then re-propagate

-- O1: audit_signed_chain — perno O1 overlay 的 evlog signed chain 持久化
-- Source: clade docs/evlog-master-plan.md § 12.3
--
-- 與 D-pattern audit_logs 的關係：
--   audit_logs (canonical)        ← D-pattern source-of-truth（hash, prev_hash 在這）
--   audit_signed_chain (derived)  ← evlog signed chain（evlog_hash 在這）
--   audit_chain_drift (alert)     ← auditDiff cron 偵測 drift 寫進這
--
-- 設計原則（lock 13）：
-- 1. 與 audit_logs 完全分檔，不對 perno production schema 加 column
-- 2. event_id 是 PRIMARY KEY 也是 FK ON DELETE RESTRICT — audit_logs 不可被刪
-- 3. evlog_hash secret 與 audit_logs hash secret 獨立；rotation 只動本表
-- 4. evlog_prev_hash 指向同 tenant 上一筆 audit_signed_chain row 的 evlog_hash

CREATE TABLE public.audit_signed_chain (
  event_id uuid PRIMARY KEY
    REFERENCES public.audit_logs(event_id) ON DELETE RESTRICT,
  -- per-tenant chain：取自 audit_logs.tenant_id（denormalize 加速 chain head 查詢）
  tenant_id uuid,
  evlog_prev_hash text,
  evlog_hash text NOT NULL,
  -- 簽章版本（rotation 時遞增；diff cron 跨版本驗證）
  signed_secret_version integer NOT NULL DEFAULT 1,
  signed_at timestamptz NOT NULL DEFAULT now()
);

-- 查詢 chain head（per tenant 找最新的）+ chain order（diff cron 依順序驗證）
CREATE INDEX audit_signed_chain_tenant_signed_at_idx
  ON public.audit_signed_chain (tenant_id, signed_at DESC, event_id DESC);

-- evlog_hash 應該唯一（HMAC payload 含 event_id + signed_at_bucket，正常情況不撞）
CREATE UNIQUE INDEX audit_signed_chain_hash_idx
  ON public.audit_signed_chain (evlog_hash);

-- ── audit_chain_drift：auditDiff cron 偵測到不一致時寫進這 ─────────────
CREATE TABLE public.audit_chain_drift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  event_id uuid REFERENCES public.audit_logs(event_id) ON DELETE SET NULL,
  drift_type text NOT NULL CHECK (drift_type IN (
    'evlog_hash_mismatch',     -- evlog_hash 重算與 DB stored 不符（secret 換 / payload 漂）
    'evlog_chain_break',       -- evlog_prev_hash 與前一筆 chain head 對不上
    'audit_logs_missing',      -- audit_signed_chain 有 row 但 audit_logs 沒對應 event_id
    'audit_signed_missing',    -- audit_logs 有 row 但 audit_signed_chain 沒（drain 漏 / 卡）
    'business_keys_drift'      -- audit_logs.business_keys 與 evlog 簽署時的 payload 不一致
  )),
  expected_hash text,
  actual_hash text,
  notes jsonb,
  resolved_at timestamptz, -- 人工 review 後標 resolved
  resolution text
);

CREATE INDEX audit_chain_drift_unresolved_idx
  ON public.audit_chain_drift (detected_at DESC) WHERE resolved_at IS NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_signed_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_chain_drift ENABLE ROW LEVEL SECURITY;

-- audit_signed_chain：service_role 寫；service_role + tenant 讀（同 audit_logs）
CREATE POLICY "service_role 可寫入" ON public.audit_signed_chain
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "service_role 可讀取" ON public.audit_signed_chain
  FOR SELECT TO service_role USING (true);

-- 不允許 UPDATE / DELETE（chain 不可改）

-- audit_chain_drift：service_role 寫；admin 讀；UPDATE 只能設 resolved_at / resolution
CREATE POLICY "service_role drift 寫入" ON public.audit_chain_drift
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "service_role drift 讀取" ON public.audit_chain_drift
  FOR SELECT TO service_role USING (true);

CREATE POLICY "service_role drift resolve" ON public.audit_chain_drift
  FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (resolved_at IS NOT NULL); -- 只允許 update 把 row 標 resolved；不可改其他欄位

-- ── 取得 tenant chain head（drain 寫入時用）──────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_signed_chain_head(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT evlog_hash
  FROM public.audit_signed_chain
  WHERE tenant_id IS NOT DISTINCT FROM p_tenant_id
  ORDER BY signed_at DESC, event_id DESC
  LIMIT 1;
$$;
