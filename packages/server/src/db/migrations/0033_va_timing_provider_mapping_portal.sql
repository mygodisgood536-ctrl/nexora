-- 0033_va_timing_provider_mapping_portal
-- Reconciles the payment-provider and Virtual-Account architecture with the
-- new product flow:
--
--   1. Virtual Accounts are issued at LOAN DISBURSEMENT (not at onboarding).
--      customers.status defaults to 'active' (a registered customer no longer
--      waits on a VA). Legacy 'va_pending' rows remain valid.
--   2. Payment provider configuration becomes genuinely COMPANY-LEVEL and
--      multi-provider: payment_provider_configs loses the single-per-company
--      UNIQUE and the mandatory branch_id.
--   3. A new branch_payment_accounts mapping links each branch to one provider
--      config plus its own distinct account identity — enabling the shared
--      provider model (many branches → one provider, per-branch accounts) AND
--      the per-branch provider model (branch B → provider B), and mixes.
--   4. Webhook signing secrets become per (company, provider).
--   5. A customer_portal_access table records the provisioned portal URL and
--      the hashed initial password (bcrypt) for the exact customer, created
--      when the loan is disbursed.

-- ---------------------------------------------------------------
-- 1. Customers: a registered customer is 'active' (no VA dependency).
-- ---------------------------------------------------------------
ALTER TABLE customers ALTER COLUMN status SET DEFAULT 'active';

-- ---------------------------------------------------------------
-- 2. Payment provider configs: company-level, multiple providers.
-- ---------------------------------------------------------------
ALTER TABLE payment_provider_configs DROP CONSTRAINT IF EXISTS payment_provider_configs_company_id_key;
ALTER TABLE payment_provider_configs DROP COLUMN IF EXISTS branch_id;
ALTER TABLE payment_provider_configs ADD CONSTRAINT payment_provider_configs_company_provider_key UNIQUE (company_id, provider);

-- ---------------------------------------------------------------
-- 3. Branch payment-account mapping.
-- ---------------------------------------------------------------
CREATE TABLE branch_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  provider_config_id uuid NOT NULL REFERENCES payment_provider_configs(id) ON DELETE CASCADE,
  account_name text NOT NULL,
  provider_account_ref text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, branch_id)
);
CREATE INDEX idx_branch_payment_accounts_branch ON branch_payment_accounts (branch_id);
CREATE INDEX idx_branch_payment_accounts_config ON branch_payment_accounts (provider_config_id);

CREATE TRIGGER trg_branch_payment_accounts_updated BEFORE UPDATE ON branch_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON branch_payment_accounts TO nexora;

ALTER TABLE branch_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_payment_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_company_scope ON branch_payment_accounts;
CREATE POLICY rls_company_scope ON branch_payment_accounts
  USING (company_id = app_current_company());

-- ---------------------------------------------------------------
-- 4. Webhook signing secrets: per (company, provider).
-- ---------------------------------------------------------------
ALTER TABLE webhook_signing_secrets DROP CONSTRAINT IF EXISTS webhook_signing_secrets_company_id_key;
DROP INDEX IF EXISTS idx_webhook_secrets_company_provider;
ALTER TABLE webhook_signing_secrets ADD CONSTRAINT webhook_signing_secrets_company_provider_key UNIQUE (company_id, provider);

-- ---------------------------------------------------------------
-- 5. Customer portal access (provisioned at disbursement).
-- ---------------------------------------------------------------
CREATE TABLE customer_portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  portal_url text NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'provisioned'
    CHECK (status IN ('provisioned','active','disabled')),
  last_login_at timestamptz,
  provisioned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_portal_access_company ON customer_portal_access (company_id, status);

CREATE TRIGGER trg_customer_portal_access_updated BEFORE UPDATE ON customer_portal_access
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON customer_portal_access TO nexora;

ALTER TABLE customer_portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_portal_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_company_scope ON customer_portal_access;
CREATE POLICY rls_company_scope ON customer_portal_access
  USING (company_id = app_current_company());
-- Bypass escape for the pre-auth login path (resolveCustomerPrincipal /
-- customerLogin run under app.bypass_rls='on').
DROP POLICY IF EXISTS rls_bypass_scope ON customer_portal_access;
CREATE POLICY rls_bypass_scope ON customer_portal_access
  FOR SELECT
  USING (COALESCE(current_setting('app.bypass_rls', true), '') = 'on');