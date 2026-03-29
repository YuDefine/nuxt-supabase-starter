-- Audit Logs Migration Template
-- Usage: supabase migration new audit_logs
-- Then paste this content into the generated file.
--
-- This creates an audit_logs table for tracking entity changes.
-- Adjust the schema and columns as needed for your project.

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  changes jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON public.audit_logs (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user
  ON public.audit_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON public.audit_logs (created_at);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- INSERT: service_role only (server API writes)
CREATE POLICY "audit_logs_insert_service_role"
  ON public.audit_logs
  FOR INSERT
  TO public
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
  );

-- SELECT: service_role or own logs
CREATE POLICY "audit_logs_select"
  ON public.audit_logs
  FOR SELECT
  TO public
  USING (
    (SELECT auth.role()) = 'service_role'
    OR user_id = auth.uid()
  );
