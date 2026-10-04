BEGIN;

ALTER TABLE loan_application_evidence
  ADD COLUMN IF NOT EXISTS identity_name text;

CREATE OR REPLACE FUNCTION loan_application_evidence_freeze_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.loan_application_id IS DISTINCT FROM OLD.loan_application_id
     OR NEW.party IS DISTINCT FROM OLD.party
     OR NEW.evidence_type IS DISTINCT FROM OLD.evidence_type
     OR NEW.identity_name IS DISTINCT FROM OLD.identity_name
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

DROP TRIGGER IF EXISTS trg_loan_application_evidence_immutable ON loan_application_evidence;
CREATE TRIGGER trg_loan_application_evidence_immutable
  BEFORE UPDATE ON loan_application_evidence
  FOR EACH ROW EXECUTE FUNCTION loan_application_evidence_freeze_identity();

COMMIT;
