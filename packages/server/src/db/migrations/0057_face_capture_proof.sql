BEGIN;

ALTER TABLE face_captures
  ADD COLUMN IF NOT EXISTS capture_proof_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_face_captures_proof
  ON face_captures (company_id, capture_proof_id)
  WHERE capture_proof_id IS NOT NULL;

CREATE OR REPLACE FUNCTION face_capture_freeze_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.loan_application_id IS DISTINCT FROM OLD.loan_application_id
     OR NEW.capture_for IS DISTINCT FROM OLD.capture_for
     OR NEW.party IS DISTINCT FROM OLD.party
     OR NEW.capture_sequence IS DISTINCT FROM OLD.capture_sequence
     OR NEW.capture_source IS DISTINCT FROM OLD.capture_source
     OR NEW.image_sha256 IS DISTINCT FROM OLD.image_sha256
     OR NEW.storage_object_ref IS DISTINCT FROM OLD.storage_object_ref
     OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.capture_proof_id IS DISTINCT FROM OLD.capture_proof_id
     OR NEW.captured_by IS DISTINCT FROM OLD.captured_by
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN
    RAISE EXCEPTION 'face capture identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_face_capture_immutable_identity ON face_captures;
CREATE TRIGGER trg_face_capture_immutable_identity
  BEFORE UPDATE ON face_captures
  FOR EACH ROW EXECUTE FUNCTION face_capture_freeze_identity();

COMMIT;
