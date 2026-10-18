-- 0099 - Company-authorised approval stage reassignment (Vision RULE 19.12.3).
--
-- RULE 19.12.3: "If an Auditor or other final pre-disbursement approval stage is
-- configured as mandatory, that stage must be resolved by an authorised
-- assignee or an explicit company-authorised reassignment path before
-- disbursement can proceed."
--
-- The rule has two halves and the platform only had one. A mandatory stage with
-- no available assignee simply threw "Mandatory approval stage N has no
-- available authorised assignee", so the loan stopped with no way forward: the
-- reassignment path the Vision names did not exist. An auditor on leave could
-- therefore freeze a customer's disbursement indefinitely with no configured
-- remedy.
--
-- This adds that path explicitly, and only explicitly: a reassignment must be
-- requested with a reason, approved by a company-authorised role, and recorded
-- with the person it was taken from and the person it was given to. A stage is
-- never unblocked implicitly and never silently skipped.
--
-- The reassignment is scoped to one application and one stage. It does not
-- reassign the person, their role, or anyone else's approvals - it authorises a
-- specific individual to decide that specific stage of that specific
-- application.

CREATE TABLE approval_stage_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
  stage_order integer NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id),
  -- Why the configured assignee could not serve: absence, vacancy, conflict.
  reason text NOT NULL CHECK (char_length(trim(reason)) > 0),
  to_user_id uuid NOT NULL REFERENCES users(id),

  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','rejected','revoked')),

  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_reason text,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revocation_reason text
);

CREATE INDEX idx_stage_reassign_application
  ON approval_stage_reassignments (application_id, stage_order, status);
CREATE INDEX idx_stage_reassign_company
  ON approval_stage_reassignments (company_id, status);

-- RULE 14.3.1 - the record must be durable and attributable. Revoking is an
-- append of new state, never an edit of what was approved.
REVOKE UPDATE, DELETE ON approval_stage_reassignments FROM nexora;
GRANT SELECT, INSERT ON approval_stage_reassignments TO nexora;

ALTER TABLE approval_stage_reassignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_stage_reassignments FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON approval_stage_reassignments
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON approval_stage_reassignments AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );