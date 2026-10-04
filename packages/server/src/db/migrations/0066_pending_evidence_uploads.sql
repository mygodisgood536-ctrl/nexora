BEGIN;

CREATE TABLE pending_evidence_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  loan_application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE RESTRICT,
  party text NOT NULL CHECK (party IN ('customer','guarantor')),
  evidence_type text NOT NULL CHECK (evidence_type IN
    ('government_id','house','business','loan_form','default_form')),
  content_sha256 text NOT NULL,
  object_identifier text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','failed','completed')),
  failure_reason text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_evidence_upload_object
  ON pending_evidence_uploads (company_id, object_identifier);

CREATE INDEX IF NOT EXISTS idx_pending_evidence_uploads_application
  ON pending_evidence_uploads (loan_application_id, status, created_at);

CREATE TRIGGER trg_pending_evidence_uploads_updated
  BEFORE UPDATE ON pending_evidence_uploads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE pending_evidence_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_evidence_uploads FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON pending_evidence_uploads
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON pending_evidence_uploads AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT, UPDATE ON pending_evidence_uploads TO nexora;
REVOKE DELETE ON pending_evidence_uploads FROM nexora;

COMMIT;
