BEGIN;

CREATE TABLE loan_application_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  loan_application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE RESTRICT,
  party text NOT NULL CHECK (party IN ('customer','guarantor')),
  evidence_type text NOT NULL CHECK (evidence_type IN
    ('government_id','house','business','loan_form','default_form')),
  capture_sequence integer NOT NULL CHECK (capture_sequence > 0),
  capture_source text NOT NULL DEFAULT 'live_camera' CHECK (capture_source = 'live_camera'),
  storage_object_ref text NOT NULL,
  image_sha256 text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
  verification_status text NOT NULL DEFAULT 'recorded'
    CHECK (verification_status IN ('recorded','verified','rejected')),
  device_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  capture_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  capture_proof_id uuid,
  captured_by uuid NOT NULL REFERENCES users(id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_application_id, evidence_type, party, capture_sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_application_evidence_proof
  ON loan_application_evidence (company_id, capture_proof_id)
  WHERE capture_proof_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loan_application_evidence_hash
  ON loan_application_evidence (image_sha256);

CREATE INDEX IF NOT EXISTS idx_loan_application_evidence_application
  ON loan_application_evidence (loan_application_id, evidence_type, party, captured_at);

CREATE OR REPLACE FUNCTION loan_application_evidence_freeze_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.loan_application_id IS DISTINCT FROM OLD.loan_application_id
     OR NEW.party IS DISTINCT FROM OLD.party
     OR NEW.evidence_type IS DISTINCT FROM OLD.evidence_type
     OR NEW.capture_sequence IS DISTINCT FROM OLD.capture_sequence
     OR NEW.capture_source IS DISTINCT FROM OLD.capture_source
     OR NEW.storage_object_ref IS DISTINCT FROM OLD.storage_object_ref
     OR NEW.image_sha256 IS DISTINCT FROM OLD.image_sha256
     OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.capture_proof_id IS DISTINCT FROM OLD.capture_proof_id
     OR NEW.captured_by IS DISTINCT FROM OLD.captured_by
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN
    RAISE EXCEPTION 'loan application evidence identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_loan_application_evidence_immutable
  BEFORE UPDATE ON loan_application_evidence
  FOR EACH ROW EXECUTE FUNCTION loan_application_evidence_freeze_identity();

ALTER TABLE loan_application_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_application_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON loan_application_evidence
  USING (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  )
  WITH CHECK (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  );

CREATE POLICY rls_branch_scope ON loan_application_evidence AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT ON loan_application_evidence TO nexora;
REVOKE UPDATE, DELETE ON loan_application_evidence FROM nexora;

COMMIT;
