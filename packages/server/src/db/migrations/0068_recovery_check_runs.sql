BEGIN;

CREATE TABLE recovery_check_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  check_type text NOT NULL,
  status text NOT NULL,
  exceptions_found integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_row_count integer NOT NULL DEFAULT 0,
  requested_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recovery_check_runs_company
  ON recovery_check_runs (company_id, completed_at DESC);

ALTER TABLE recovery_check_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_check_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON recovery_check_runs
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

GRANT SELECT, INSERT ON recovery_check_runs TO nexora;
REVOKE UPDATE, DELETE ON recovery_check_runs FROM nexora;

COMMIT;
