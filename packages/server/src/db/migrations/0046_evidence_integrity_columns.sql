-- 0046_evidence_integrity_columns
-- Part 20.1.1 / 20.1.2 / RULE 9.4.7: capture evidence must be retained with
-- immutable object identity, storage object reference, file size, MIME type,
-- device metadata, location and verification status. The 0036 face_captures
-- table stored only a SHA-256 digest + a generic metadata jsonb and claimed
-- (incorrectly) that image bytes are never retained — Part 18 decision #10
-- concerns the ENCRYPTED face-reuse template, not the capture evidence the
-- customer submitted. This migration adds the missing evidence columns.
--
-- RULE 19.7 / RULE 19.10 / RULE 20.1.2: loan_documents must be immutable
-- evidence with a content hash so the record can be proven unmodified. This
-- migration adds a file hash + size + MIME and blocks UPDATE of the content
-- identity columns after insert.

BEGIN;

-- face_captures: evidence completeness (Part 20 Figure "storage object ref",
-- file size, MIME type, verification status).
ALTER TABLE face_captures
  ADD COLUMN IF NOT EXISTS storage_object_ref text,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'recorded'
    CHECK (verification_status IN ('recorded','verified','rejected')),
  ADD COLUMN IF NOT EXISTS device_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS location jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

UPDATE face_captures SET storage_object_ref = NULL WHERE storage_object_ref IS NULL;

-- loan_documents: content identity hash for immutability proof (RULE 19.7/10).
ALTER TABLE loan_documents
  ADD COLUMN IF NOT EXISTS file_sha256 text,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS mime_type text;

-- RULE 19.7 — a loan document is immutable evidence once uploaded: the
-- content-identity columns may only carry their original values.
CREATE OR REPLACE FUNCTION loan_document_freeze_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
     OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.file_url IS DISTINCT FROM OLD.file_url THEN
    RAISE EXCEPTION 'loan document content identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_loan_document_immutable_identity ON loan_documents;
CREATE TRIGGER trg_loan_document_immutable_identity
  BEFORE UPDATE OF file_sha256, file_size_bytes, mime_type, file_url ON loan_documents
  FOR EACH ROW EXECUTE FUNCTION loan_document_freeze_identity();

COMMIT;