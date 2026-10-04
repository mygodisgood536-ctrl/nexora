BEGIN;

CREATE TABLE loan_application_terms (
  application_id uuid PRIMARY KEY REFERENCES loan_applications(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  repayment_mode text NOT NULL CHECK (repayment_mode IN ('weekly','daily')),
  repayment_weekday smallint CHECK (repayment_weekday IS NULL OR repayment_weekday BETWEEN 0 AND 6),
  repayment_periods integer NOT NULL CHECK (repayment_periods > 0),
  interest_percentage numeric(9,4) NOT NULL CHECK (interest_percentage >= 0),
  repayment_amount numeric(14,2) NOT NULL CHECK (repayment_amount > 0),
  calculated_interest numeric(14,2) NOT NULL CHECK (calculated_interest >= 0),
  calculated_total_repayment numeric(14,2) NOT NULL CHECK (calculated_total_repayment > 0),
  tally_status text NOT NULL CHECK (tally_status IN ('matched','not_tally')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_loan_application_terms_company
  ON loan_application_terms (company_id, created_at);

CREATE TRIGGER trg_loan_application_terms_updated
  BEFORE UPDATE ON loan_application_terms
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE loan_application_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_application_terms FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON loan_application_terms
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON loan_application_terms AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT, UPDATE ON loan_application_terms TO nexora;
REVOKE DELETE ON loan_application_terms FROM nexora;

COMMIT;
