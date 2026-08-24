CREATE TABLE approval_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  on_rejection text NOT NULL DEFAULT 'return_to_applicant'
    CHECK (on_rejection IN ('return_to_applicant','previous_stage')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX idx_approval_chains_company ON approval_chains (company_id);

CREATE TRIGGER trg_approval_chains_updated BEFORE UPDATE ON approval_chains
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE approval_chain_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chain_id uuid NOT NULL REFERENCES approval_chains(id) ON DELETE CASCADE,
  stage_order integer NOT NULL CHECK (stage_order > 0),
  step_name text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id),
  UNIQUE (chain_id, stage_order)
);
CREATE INDEX idx_chain_steps_company ON approval_chain_steps (company_id);
CREATE INDEX idx_chain_steps_role ON approval_chain_steps (role_id);

CREATE TABLE loan_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  min_principal numeric NOT NULL CHECK (min_principal > 0),
  max_principal numeric NOT NULL CHECK (max_principal >= min_principal),
  interest_rate numeric NOT NULL CHECK (interest_rate >= 0),
  interest_method text,
  cycle_days integer NOT NULL CHECK (cycle_days > 0),
  cycle_count integer NOT NULL CHECK (cycle_count > 0),
  expected_repayment_per_cycle numeric NOT NULL CHECK (expected_repayment_per_cycle >= 0),
  expected_savings_per_cycle numeric NOT NULL CHECK (expected_savings_per_cycle >= 0),
  approval_chain_id uuid NOT NULL REFERENCES approval_chains(id),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX idx_loan_products_company_active ON loan_products (company_id, is_active);

CREATE TRIGGER trg_loan_products_updated BEFORE UPDATE ON loan_products
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE loan_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  product_id uuid NOT NULL REFERENCES loan_products(id),
  chain_id uuid NOT NULL REFERENCES approval_chains(id),
  principal_amount numeric NOT NULL CHECK (principal_amount > 0),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','in_review','approved','rejected','disbursed','withdrawn')),
  current_stage_order integer,
  submitted_by uuid NOT NULL REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  rejection_reason text,
  disbursed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rejected_requires_reason CHECK (
    status <> 'rejected' OR (rejection_reason IS NOT NULL AND char_length(rejection_reason) > 0)
  )
);
CREATE INDEX idx_applications_company_status ON loan_applications (company_id, status);
CREATE INDEX idx_applications_branch_status ON loan_applications (branch_id, status);
CREATE INDEX idx_applications_customer ON loan_applications (customer_id);

CREATE TRIGGER trg_applications_updated BEFORE UPDATE ON loan_applications
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE loan_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES loan_applications(id),
  doc_type text NOT NULL,
  file_url text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  confirmed boolean NOT NULL DEFAULT false,
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz
);
CREATE INDEX idx_loan_documents_application ON loan_documents (application_id);

CREATE TABLE credit_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES loan_applications(id),
  assessed_by uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('approve','reject','request_information')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_assessments_application ON credit_assessments (application_id);

REVOKE UPDATE, DELETE ON credit_assessments FROM nexora;

CREATE TABLE loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  application_id uuid NOT NULL UNIQUE REFERENCES loan_applications(id),
  product_id uuid NOT NULL REFERENCES loan_products(id),
  principal_amount numeric NOT NULL CHECK (principal_amount > 0),
  interest_rate numeric NOT NULL CHECK (interest_rate >= 0),
  interest_method text,
  cycle_days integer NOT NULL CHECK (cycle_days > 0),
  cycle_count integer NOT NULL CHECK (cycle_count > 0),
  expected_repayment_per_cycle numeric NOT NULL CHECK (expected_repayment_per_cycle >= 0),
  expected_savings_per_cycle numeric NOT NULL CHECK (expected_savings_per_cycle >= 0),
  outstanding_principal numeric NOT NULL DEFAULT 0 CHECK (outstanding_principal >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','overdue','completed')),
  disbursed_by uuid NOT NULL REFERENCES users(id),
  disbursed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_loans_company_branch_status ON loans (company_id, branch_id, status);
CREATE INDEX idx_loans_customer ON loans (customer_id);

CREATE TRIGGER trg_loans_updated BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

REVOKE DELETE ON loans FROM nexora;

CREATE TABLE repayment_schedule_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES loans(id),
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  due_date date NOT NULL,
  expected_repayment numeric NOT NULL CHECK (expected_repayment >= 0),
  expected_savings numeric NOT NULL CHECK (expected_savings >= 0),
  actual_repayment numeric NOT NULL DEFAULT 0 CHECK (actual_repayment >= 0),
  actual_savings numeric NOT NULL DEFAULT 0 CHECK (actual_savings >= 0),
  paid_at timestamptz,
  UNIQUE (loan_id, cycle_number),
  UNIQUE (loan_id, due_date)
);
CREATE INDEX idx_schedule_company_due_date ON repayment_schedule_rows (company_id, due_date);
CREATE INDEX idx_schedule_loan ON repayment_schedule_rows (loan_id, due_date);

REVOKE DELETE ON repayment_schedule_rows FROM nexora;
