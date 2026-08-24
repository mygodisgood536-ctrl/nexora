CREATE TABLE virtual_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  provider text NOT NULL,
  bank_name text NOT NULL,
  account_name text NOT NULL,
  account_number text NOT NULL,
  provider_reference text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','replaced','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, account_number)
);
CREATE INDEX idx_virtual_accounts_customer ON virtual_accounts (customer_id);
CREATE INDEX idx_virtual_accounts_company_status ON virtual_accounts (company_id, status);
CREATE UNIQUE INDEX uq_va_one_active_per_customer
  ON virtual_accounts (customer_id) WHERE status = 'active';

REVOKE DELETE ON virtual_accounts FROM nexora;

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  virtual_account_id uuid REFERENCES virtual_accounts(id),
  provider text NOT NULL,
  provider_txn_ref text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  value_date timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN (
      'received','verified','identified','allocated','posted','completed',
      'duplicate_suppressed','unmatched','unallocated',
      'incomplete_processing','reversed'
    )),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (provider, provider_txn_ref)
);
CREATE INDEX idx_payments_company_customer ON payments (company_id, customer_id);
CREATE INDEX idx_payments_company_value_date ON payments (company_id, value_date);

REVOKE UPDATE ON payments FROM nexora;
GRANT UPDATE (status) ON payments TO nexora;
REVOKE DELETE ON payments FROM nexora;

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(id),
  loan_id uuid REFERENCES loans(id),
  schedule_row_id uuid REFERENCES repayment_schedule_rows(id),
  repayment_amount numeric NOT NULL DEFAULT 0 CHECK (repayment_amount >= 0),
  savings_amount numeric NOT NULL DEFAULT 0 CHECK (savings_amount >= 0),
  rollover_amount numeric NOT NULL DEFAULT 0 CHECK (rollover_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allocation_moves_money CHECK (
    repayment_amount + savings_amount + rollover_amount > 0
  )
);
CREATE INDEX idx_allocations_payment ON payment_allocations (payment_id);
CREATE INDEX idx_allocations_loan ON payment_allocations (loan_id);

REVOKE UPDATE, DELETE ON payment_allocations FROM nexora;

CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  original_payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  provider_txn_ref text,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reversals_company ON payment_reversals (company_id);

REVOKE UPDATE, DELETE ON payment_reversals FROM nexora;

CREATE TABLE webhook_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id),
  webhook_event_id uuid REFERENCES webhook_events(id),
  provider text NOT NULL,
  exception_type text NOT NULL
    CHECK (exception_type IN ('invalid_signature','malformed','verification_failed')),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail text,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_exceptions_open ON webhook_exceptions (resolved, created_at DESC);

CREATE TABLE pipeline_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(id),
  step_number smallint NOT NULL CHECK (step_number BETWEEN 1 AND 13),
  step_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','retrying')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (payment_id, step_number)
);
CREATE INDEX idx_pipeline_jobs_status ON pipeline_jobs (status, step_number);

CREATE TABLE savings_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid NOT NULL UNIQUE REFERENCES customers(id),
  balance numeric NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','closed')),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_savings_accounts_company_branch ON savings_accounts (company_id, branch_id);

CREATE TRIGGER trg_savings_accounts_updated BEFORE UPDATE ON savings_accounts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

REVOKE DELETE ON savings_accounts FROM nexora;

CREATE TABLE savings_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  savings_account_id uuid NOT NULL REFERENCES savings_accounts(id),
  payment_id uuid REFERENCES payments(id),
  direction text NOT NULL CHECK (direction IN ('credit','debit')),
  amount numeric NOT NULL CHECK (amount > 0),
  balance_after numeric NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_savings_tx_account ON savings_transactions (savings_account_id, created_at DESC);

REVOKE UPDATE, DELETE ON savings_transactions FROM nexora;
