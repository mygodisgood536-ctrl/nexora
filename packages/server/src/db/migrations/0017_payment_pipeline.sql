-- Stage 7D — Part 1 Section 21: Cashless payment pipeline + webhooks.
-- Adds per-company provider configuration, signed-webhook secret storage,
-- and the persistent exception queues referenced by the 11 exception
-- types enumerated in Section 21 (Part 1).
--
-- Existing tables (0007_payments, 0009_comms_audit) already provide:
--   payments, payment_allocations, payment_reversals, webhook_exceptions,
--   pipeline_jobs, savings_accounts, savings_transactions
--
-- This migration only adds the missing pieces: provider config + secret
-- storage, the unmatched/unallocated exception queues, reconciliation
-- items, and the RLS that keeps every one of those tables inside the
-- caller's tenant.

-- Per-company payment provider configuration.
-- Each company configures its own payment provider integration: API
-- credentials, webhook endpoint, account-issuance settings.
CREATE TABLE payment_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  provider text NOT NULL,
  api_base_url text NOT NULL,
  api_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_name_nonempty CHECK (length(provider) > 0),
  CONSTRAINT provider_api_base_url_nonempty CHECK (length(api_base_url) > 0),
  CONSTRAINT provider_api_key_nonempty CHECK (length(api_key) > 0)
);
CREATE INDEX idx_provider_configs_company ON payment_provider_configs (company_id);

CREATE TRIGGER trg_provider_configs_updated BEFORE UPDATE ON payment_provider_configs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Base DML grants for the app role. These tables are created in this migration,
-- AFTER the 0010 grant loop that covers earlier tables, so without explicit
-- grants the `nexora` role gets "permission denied". The app role replaces an
-- existing config on rotation (DELETE + INSERT), so DELETE must be granted here.
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_provider_configs TO nexora;

-- Per-company HMAC signing secret for incoming webhooks.
-- Kept separate from `payment_provider_configs` so a secret rotation
-- does not force a rewrite of the provider-config row, and so a query
-- that loads the config does not accidentally surface the secret in
-- logs / error traces.
CREATE TABLE webhook_signing_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  secret text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_secrets_company_provider
  ON webhook_signing_secrets (company_id, provider);

-- App role needs SELECT (load signing secret) + INSERT/DELETE (secret rotation
-- on provider reconfiguration). UPDATE is intentionally not granted.
GRANT SELECT, INSERT, DELETE ON webhook_signing_secrets TO nexora;

-- Persistent exception queues surfaced to Finance/IT/Branch (Part 1
-- §21 exception-handling table).
--
--  • unmatched_payments: webhook received but the virtual account could
--    not be resolved to a known customer. Money was confirmed by the
--    provider; the funds are held here for manual reconciliation.
--  • unallocated_payments: webhook received, customer resolved, but
--    the allocation engine could not apply the funds (e.g. all loans
--    closed or multi-loan case unresolvable). Funds are still recorded
--    as received but flagged for manual allocation review.
--
-- Both are append-only by design — they are evidence trails, not
-- working state. Resolution is recorded as a sibling allocation /
-- reversal; the exception row itself is preserved.
CREATE TABLE unmatched_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  provider text NOT NULL,
  provider_account_number text NOT NULL,
  provider_reference text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_unmatched_open ON unmatched_payments (resolved, created_at DESC);
CREATE INDEX idx_unmatched_company ON unmatched_payments (company_id, created_at DESC);

GRANT SELECT, INSERT ON unmatched_payments TO nexora;
REVOKE UPDATE, DELETE ON unmatched_payments FROM nexora;
GRANT UPDATE (resolved, resolved_by, resolved_at, resolution_note)
  ON unmatched_payments TO nexora;

CREATE TABLE unallocated_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  reason text NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_unallocated_open ON unallocated_payments (resolved, created_at DESC);
CREATE INDEX idx_unallocated_company ON unallocated_payments (company_id, created_at DESC);

GRANT SELECT, INSERT ON unallocated_payments TO nexora;
REVOKE UPDATE, DELETE ON unallocated_payments FROM nexora;
GRANT UPDATE (resolved, resolved_by, resolved_at, resolution_note)
  ON unallocated_payments TO nexora;

-- Reconciliation items: the persistent, resolvable record of the
-- differences surfaced by the periodic reconciliation diff
-- (provider-known vs. Nexora-known). Part 1 §21 calls this out
-- explicitly — a report that is generated and forgotten is forbidden.
--
-- The table is owned by 0008_finance (created there with item_type
-- enum including 'unallocated_payment' / 'unmatched_payment' /
-- 'reversed_transaction' / 'incomplete_processing'). RLS is set by
-- 0010_rls. This migration just adds two indexes that the §21
-- reconciliation queries need (open-by-tenant + by payment).
CREATE INDEX IF NOT EXISTS idx_recon_open
  ON reconciliation_items (company_id, status, created_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_recon_payment
  ON reconciliation_items (payment_id);

-- RLS for the new tables — same tenant-scoped policy used by every
-- other company-owned table (0007_payments / 0010_rls baseline).
--
-- NOTE: the policy must reuse app_current_company() (the NULLIF-guarded
-- accessor from 0010) instead of casting current_setting('app.company_id')
-- directly. A raw `current_setting(...)::uuid` cast throws
-- "invalid input syntax for type uuid" whenever the GUC holds its
-- placeholder default '' (which happens on a pooled connection after a
-- prior SET LOCAL committed), breaking the webhook verify path.
ALTER TABLE payment_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_provider_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_company_scope ON payment_provider_configs;
CREATE POLICY rls_company_scope ON payment_provider_configs
  USING (company_id = app_current_company());

ALTER TABLE webhook_signing_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_signing_secrets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_company_scope ON webhook_signing_secrets;
CREATE POLICY rls_company_scope ON webhook_signing_secrets
  USING (company_id = app_current_company());

ALTER TABLE unmatched_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE unmatched_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_company_scope ON unmatched_payments;
CREATE POLICY rls_company_scope ON unmatched_payments
  USING (company_id = app_current_company());

ALTER TABLE unallocated_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE unallocated_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_company_scope ON unallocated_payments;
CREATE POLICY rls_company_scope ON unallocated_payments
  USING (company_id = app_current_company());

-- webhook_exceptions carries the baseline rls_tenant policy (0010), which
-- hides every row when no tenant session is set. The platform admin route
-- lists platform-level exceptions (company_id IS NULL) under bypass_rls,
-- so add a bypass-scoped SELECT policy (permissive policies are OR-ed with
-- rls_tenant, so org sessions stay company-scoped and only the platform
-- bypass path sees all rows).
ALTER TABLE webhook_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_exceptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_platform_scope ON webhook_exceptions;
CREATE POLICY rls_platform_scope ON webhook_exceptions
  FOR SELECT
  USING (COALESCE(current_setting('app.bypass_rls', true), '') = 'on');

ALTER TABLE reconciliation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_items FORCE ROW LEVEL SECURITY;
-- RLS policy is set by 0010_rls; do not redefine here.





