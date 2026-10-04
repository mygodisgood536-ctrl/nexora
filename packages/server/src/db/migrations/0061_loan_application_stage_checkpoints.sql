BEGIN;

CREATE TABLE loan_application_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  stage_key text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  status text NOT NULL CHECK (status IN ('draft','saved','completed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, stage_key)
);

CREATE INDEX idx_loan_application_stages_application
  ON loan_application_stages (application_id, sequence);

CREATE TRIGGER trg_loan_application_stages_updated
  BEFORE UPDATE ON loan_application_stages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE loan_application_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_application_stages FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON loan_application_stages
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON loan_application_stages AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT, UPDATE ON loan_application_stages TO nexora;
REVOKE DELETE ON loan_application_stages FROM nexora;

COMMIT;
