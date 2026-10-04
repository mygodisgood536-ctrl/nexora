-- RULE 9.5.3 — a customer cannot be disbursed without a working virtual
-- account. When the provider call fails, the disbursement is held in a visible
-- "virtual account pending" state, the branch and Finance are notified, and the
-- system retries. The application is never rolled back or duplicated.
CREATE TABLE disbursement_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  hold_reason text NOT NULL,
  failure_code text NOT NULL,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  status text NOT NULL DEFAULT 'virtual_account_pending'
    CHECK (status IN ('virtual_account_pending','resolved','abandoned')),
  notified_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_disbursement_hold_open
  ON disbursement_holds (application_id)
  WHERE status = 'virtual_account_pending';

CREATE INDEX idx_disbursement_holds_company
  ON disbursement_holds (company_id, status, created_at DESC);

CREATE TRIGGER trg_disbursement_holds_updated
  BEFORE UPDATE ON disbursement_holds
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE disbursement_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement_holds FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON disbursement_holds
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON disbursement_holds AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT, UPDATE ON disbursement_holds TO nexora;
REVOKE DELETE ON disbursement_holds FROM nexora;
