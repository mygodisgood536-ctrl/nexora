BEGIN;

-- RULE 19.4.3 — the guarantor is a first-class application party with its own
-- required information and its own evidence, not a text field or attachment.
CREATE TABLE loan_application_guarantors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  loan_application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 200),
  relationship text NOT NULL CHECK (char_length(btrim(relationship)) BETWEEN 2 AND 80),
  phone text NOT NULL CHECK (char_length(btrim(phone)) BETWEEN 3 AND 40),
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 2 AND 400),
  occupation text,
  house_address text,
  street text,
  direction_to_house text,
  local_area_known_as text,
  shop_address text,
  child_name text,
  average_daily_income numeric(14,2) CHECK (average_daily_income >= 0),
  average_monthly_income numeric(14,2) CHECK (average_monthly_income >= 0),
  identification_type text,
  identification_number text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  supersedes_guarantor_id uuid REFERENCES loan_application_guarantors(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_loan_application_guarantor_active
  ON loan_application_guarantors (loan_application_id)
  WHERE status = 'active';

CREATE INDEX idx_loan_application_guarantors_company
  ON loan_application_guarantors (company_id, created_at DESC);

CREATE INDEX idx_loan_application_guarantors_customer
  ON loan_application_guarantors (customer_id, status);

CREATE TRIGGER trg_loan_application_guarantors_updated
  BEFORE UPDATE ON loan_application_guarantors
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE loan_application_guarantors ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_application_guarantors FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON loan_application_guarantors
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON loan_application_guarantors AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT, UPDATE ON loan_application_guarantors TO nexora;
REVOKE DELETE ON loan_application_guarantors FROM nexora;

-- RULE 19.4.1 — the application captures the required customer information and
-- RULE 19.4.2 — it is saved before the application proceeds to the next stage.
CREATE TABLE loan_application_party_information (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  loan_application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  party text NOT NULL CHECK (party IN ('customer','guarantor')),
  guarantor_id uuid REFERENCES loan_application_guarantors(id) ON DELETE RESTRICT,
  next_of_kin_name text,
  next_of_kin_relationship text,
  next_of_kin_phone text,
  occupation text,
  house_address text,
  street text,
  direction_to_house text,
  child_name text,
  local_area_known_as text,
  shop_address text,
  average_daily_income numeric(14,2) CHECK (average_daily_income >= 0),
  average_monthly_income numeric(14,2) CHECK (average_monthly_income >= 0),
  saved_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  saved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_application_id, party)
);

CREATE TRIGGER trg_loan_application_party_information_updated
  BEFORE UPDATE ON loan_application_party_information
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE loan_application_party_information ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_application_party_information FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON loan_application_party_information
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON loan_application_party_information AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT, UPDATE ON loan_application_party_information TO nexora;
REVOKE DELETE ON loan_application_party_information FROM nexora;

-- Evidence and face captures for the guarantor now bind to the guarantor identity
-- itself, so a guarantor government ID is matched against the guarantor's name
-- (RULE 19.7.2) rather than the borrower's.
ALTER TABLE loan_application_evidence
  ADD COLUMN guarantor_id uuid REFERENCES loan_application_guarantors(id) ON DELETE RESTRICT;

ALTER TABLE face_captures
  ADD COLUMN guarantor_id uuid REFERENCES loan_application_guarantors(id) ON DELETE RESTRICT;

CREATE INDEX idx_face_captures_guarantor ON face_captures (guarantor_id) WHERE guarantor_id IS NOT NULL;
CREATE INDEX idx_loan_application_evidence_guarantor
  ON loan_application_evidence (guarantor_id) WHERE guarantor_id IS NOT NULL;

-- RULE 19.12.8 — Return for Information is a separate auditable state and is
-- never disguised as rejection.
ALTER TABLE loan_applications DROP CONSTRAINT loan_applications_status_check;
ALTER TABLE loan_applications ADD CONSTRAINT loan_applications_status_check
  CHECK (status IN ('submitted','in_review','information_requested','approved','rejected','disbursed','withdrawn'));

-- RULE 19.1.4 — group role and marital status are selected from configured
-- options, never free-typed.
CREATE TABLE company_group_options (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  option_kind text NOT NULL CHECK (option_kind IN ('group_role','marital_status')),
  option_value text NOT NULL CHECK (char_length(btrim(option_value)) BETWEEN 1 AND 80),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, option_kind, option_value)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON company_group_options TO nexora;

ALTER TABLE company_group_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_group_options FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON company_group_options
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

COMMIT;
