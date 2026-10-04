BEGIN;

CREATE TABLE loan_application_bank_details (
  application_id uuid PRIMARY KEY REFERENCES loan_applications(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  bank_name text NOT NULL CHECK (char_length(bank_name) BETWEEN 2 AND 120),
  account_number text NOT NULL CHECK (char_length(account_number) BETWEEN 8 AND 34),
  account_name text NOT NULL CHECK (char_length(account_name) BETWEEN 2 AND 200),
  identity_name text NOT NULL CHECK (char_length(identity_name) BETWEEN 2 AND 200),
  match_status text NOT NULL CHECK (match_status IN ('matched','mismatch')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_loan_application_bank_details_company
  ON loan_application_bank_details (company_id, created_at);

ALTER TABLE loan_application_bank_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_application_bank_details FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON loan_application_bank_details
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON loan_application_bank_details AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT ON loan_application_bank_details TO nexora;
REVOKE UPDATE, DELETE ON loan_application_bank_details FROM nexora;

COMMIT;
