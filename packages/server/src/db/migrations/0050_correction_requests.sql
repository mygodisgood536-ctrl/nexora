-- 0050_correction_requests
-- RULE 5.6.3 / 11.4.3 — a financial correction is never an edit. Finance may
-- investigate and prepare a correction request; only MD, GM and an authorised
-- Auditor may approve it; the system then posts a new, linked, audit-logged
-- reversal record and the original payment, allocation, schedule and journal
-- entries stay permanently intact.
--
-- The request is a first-class, auditable object with its own lifecycle so
-- that "who asked, who approved, on what authority, and when" is provable.

BEGIN;

CREATE TABLE correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  kind text NOT NULL DEFAULT 'reversal'
    CHECK (kind IN ('reversal','correction')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','rejected','posted')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_reason text,
  posted_reversal_id uuid REFERENCES payment_reversals(id),
  posted_at timestamptz
);

CREATE INDEX idx_correction_requests_company_status
  ON correction_requests (company_id, status);
CREATE INDEX idx_correction_requests_payment
  ON correction_requests (payment_id);

-- Fail-closed tenant isolation: a company session sees only its own correction
-- requests, exactly like every other company-scoped table (Part 1 A9).
ALTER TABLE correction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE correction_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON correction_requests
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

-- A branch-scoped session may only reach its own branch's correction requests.
CREATE POLICY rls_branch_scope ON correction_requests AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

-- The request is a workflow object, not a financial record: it must advance
-- requested -> approved/rejected -> posted, so the app role needs UPDATE. What
-- it must never do is delete a request, and the financial records it points at
-- (payments, allocations, journal) remain append-only under their own revokes.
REVOKE DELETE ON correction_requests FROM nexora;

GRANT SELECT, INSERT, UPDATE ON correction_requests TO nexora;

-- The Platform Owner reads these only through the company drill-down, which
-- is structural; the table carries no platform-wide SELECT grant.

COMMIT;
