BEGIN;

ALTER TABLE face_captures
  ADD COLUMN IF NOT EXISTS party text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS capture_sequence integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS capture_source text NOT NULL DEFAULT 'live_camera';

UPDATE face_captures
   SET branch_id = c.branch_id
  FROM customers c
 WHERE c.id = face_captures.customer_id
   AND face_captures.branch_id IS NULL;

ALTER TABLE face_captures
  ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE face_captures DROP CONSTRAINT IF EXISTS face_captures_party_check;
ALTER TABLE face_captures ADD CONSTRAINT face_captures_party_check
  CHECK (party IN ('customer','guarantor'));

ALTER TABLE face_captures DROP CONSTRAINT IF EXISTS face_captures_sequence_check;
ALTER TABLE face_captures ADD CONSTRAINT face_captures_sequence_check
  CHECK (capture_sequence > 0);

ALTER TABLE face_captures DROP CONSTRAINT IF EXISTS face_captures_source_check;
ALTER TABLE face_captures ADD CONSTRAINT face_captures_source_check
  CHECK (capture_source = 'live_camera');

ALTER TABLE face_captures DROP CONSTRAINT IF EXISTS face_captures_application_scope;
ALTER TABLE face_captures ADD CONSTRAINT face_captures_application_scope
  CHECK (
    (capture_for = 'registration' AND loan_application_id IS NULL)
    OR (capture_for = 'loan_application' AND loan_application_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_face_captures_customer_sequence
  ON face_captures (customer_id, capture_for, capture_sequence);

CREATE INDEX IF NOT EXISTS idx_face_captures_company_branch
  ON face_captures (company_id, branch_id, created_at);

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

DROP POLICY IF EXISTS rls_company_scope ON face_captures;
CREATE POLICY rls_tenant ON face_captures
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

DROP POLICY IF EXISTS rls_branch_scope ON face_captures;
CREATE POLICY rls_branch_scope ON face_captures AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

COMMIT;
