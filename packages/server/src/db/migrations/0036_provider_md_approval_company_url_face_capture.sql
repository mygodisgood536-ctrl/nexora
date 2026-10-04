-- 0036_provider_md_approval_company_url_face_capture
--  1. payment_provider_configs: MD authorisation record. Per Part 7 the IT/System
--     Administrator configures provider credentials but the MD authorises; a
--     config that is not MD-approved cannot receive webhooks.
--  2. companies.portal_url: the company-level URL (unit loan model) set at
--     company creation; branch URLs reuse the same portal URL (Rule: one exact
--     URL reused by every worker of a branch).
--  3. face_captures: immutable live-capture records for customers (registration)
--     and loan applications. Image bytes are NOT retained (Part 18 decision #10);
--     only the SHA-256 digest + capture metadata (liveness flag, device, geo,
--     captured-by, timestamp) are stored. Reuse detection compares digests.

BEGIN;

ALTER TABLE payment_provider_configs
  ADD COLUMN IF NOT EXISTS md_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS md_approved_by uuid REFERENCES users(id);

GRANT UPDATE (md_approved_at, md_approved_by) ON payment_provider_configs TO nexora;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS portal_url text;

CREATE TABLE IF NOT EXISTS face_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  capture_for text NOT NULL CHECK (capture_for IN ('registration','loan_application')),
  loan_application_id uuid REFERENCES loan_applications(id),
  image_sha256 text NOT NULL,
  liveness_checked boolean NOT NULL DEFAULT false,
  capture_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_face_captures_customer ON face_captures (customer_id, capture_for);
CREATE INDEX idx_face_captures_application ON face_captures (loan_application_id);
CREATE INDEX idx_face_captures_hash ON face_captures (image_sha256);

CREATE UNIQUE INDEX IF NOT EXISTS uq_face_captures_app ON face_captures (loan_application_id)
  WHERE loan_application_id IS NOT NULL;

GRANT SELECT, INSERT ON face_captures TO nexora;
REVOKE UPDATE, DELETE ON face_captures FROM nexora;

ALTER TABLE face_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_captures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_company_scope ON face_captures;
CREATE POLICY rls_company_scope ON face_captures
  USING (company_id = app_current_company());

COMMIT;