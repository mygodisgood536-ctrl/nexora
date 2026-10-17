-- 0097 - Write-off and restructuring as configured, audited processes
-- (Vision RULE 10.6.3 / 4.4.1 / 20.3.2).
--
-- RULE 10.6.3: "Restructuring and write-off are configured processes with their
-- own approval chain; they create new records and never edit the original loan
-- history."
--
-- Neither existed: `loans.status` allowed only active/overdue/completed, so a
-- loan could be paid off, overdue, or completed and nothing else. There was no
-- way to write off a bad debt or to restructure a loan a customer could not
-- service, and RULE 4.4.1's command view could never show a written-off or
-- restructured amount.
--
-- The adjustment is a NEW linked record. The original loan row, its repayment
-- schedule, its payments, allocations and journal entries are never edited or
-- rewritten - only the loan's own status moves, which is a state transition the
-- adjustment record explains and the audit trail records.

ALTER TABLE loans
  DROP CONSTRAINT IF EXISTS loans_status_check;

ALTER TABLE loans
  ADD CONSTRAINT loans_status_check
  CHECK (status IN ('active','overdue','completed','restructured','written_off'));

-- RULE 10.6.3 requires a restructuring to CREATE A NEW LOAN, but migration 0006
-- declared loans.application_id UNIQUE, which made a second loan for the same
-- application impossible. The uniqueness that actually matters is "one ORIGINAL
-- loan per application"; a restructured replacement is a derived record that
-- points back at its origin. So the blanket constraint becomes a partial unique
-- index that still guarantees exactly one original per application, while
-- origin_loan_id makes the lineage explicit and navigable from either side.
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS origin_loan_id uuid REFERENCES loans(id);

ALTER TABLE loans
  DROP CONSTRAINT IF EXISTS loans_application_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_loans_application_origin
  ON loans (application_id)
  WHERE origin_loan_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_loans_origin ON loans (origin_loan_id)
  WHERE origin_loan_id IS NOT NULL;

CREATE TABLE loan_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  loan_id uuid NOT NULL REFERENCES loans(id),

  -- RULE 10.6.3 - the two configured processes.
  kind text NOT NULL CHECK (kind IN ('write_off','restructuring')),

  reason text NOT NULL CHECK (char_length(trim(reason)) > 0),

  -- A configured approval chain, snapshotted onto the request so that changing
  -- the company's chain later cannot rewrite who was required to approve this.
  approval_chain_id uuid REFERENCES approval_chains(id),
  required_approver_role_keys text[] NOT NULL DEFAULT '{}',

  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','rejected','posted')),

  -- What the process changes, recorded as an immutable before/after pair.
  previous_state jsonb NOT NULL,
  new_state jsonb NOT NULL,

  -- RULE 10.6.3 - a restructuring produces a NEW loan linked to the original.
  -- The original is never rewritten; it is only marked restructured.
  supersedes_loan_id uuid REFERENCES loans(id),
  superseding_loan_id uuid REFERENCES loans(id),

  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),

  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_reason text,
  posted_at timestamptz
);

CREATE INDEX idx_loan_adjustments_loan ON loan_adjustments (loan_id, requested_at DESC);
CREATE INDEX idx_loan_adjustments_company ON loan_adjustments (company_id, status);

-- RULE 20.3.2 - corrections use linked records and the original stays intact.
-- The record is append-only once posted: no update, and never a delete.
REVOKE UPDATE, DELETE ON loan_adjustments FROM nexora;
GRANT SELECT, INSERT ON loan_adjustments TO nexora;

ALTER TABLE loan_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_adjustments FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON loan_adjustments
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON loan_adjustments AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );