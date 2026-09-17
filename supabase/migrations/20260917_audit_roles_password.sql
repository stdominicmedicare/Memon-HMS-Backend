-- Security: audit trail, staff roles, password_changed_at
-- Apply after 20260917_lock_down_rls.sql on existing projects.

-- Extra staff roles (checklist: nurse, receptionist, records officer)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'Nurse';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'Receptionist';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'RecordsOfficer';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now();

-- Append-only PHI audit log
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email text,
  actor_role text,
  action text NOT NULL CHECK (action IN ('view', 'create', 'edit', 'delete')),
  resource_type text NOT NULL DEFAULT 'medical_record',
  resource_id uuid,
  patient_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_patient_idx ON public.audit_logs (patient_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON public.audit_logs (resource_type, resource_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

CREATE OR REPLACE FUNCTION public.audit_logs_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only and cannot be modified or deleted';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE PROCEDURE public.audit_logs_immutable();
