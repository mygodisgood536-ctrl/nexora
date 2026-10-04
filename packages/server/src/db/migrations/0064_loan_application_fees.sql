BEGIN;

CREATE TABLE loan_application_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  fee_type text NOT NULL CHECK (char_length(fee_type) BETWEEN 2 AND 80),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('obligation','waived','pending_payment')),
  financial_payment_id uuid REFERENCES payments(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, fee_type)
);

CREATE INDEX idx_loan_application_fees_application
  ON loan_application_fees (application_id, created_at);

ALTER TABLE loan_application_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_application_fees FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON loan_application_fees
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON loan_application_fees AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT ON loan_application_fees TO nexora;
REVOKE UPDATE, DELETE ON loan_application_fees FROM nexora;

COMMIT;
