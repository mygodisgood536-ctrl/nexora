-- 0022_tenant_scoped_uniqueness.sql
-- Phase 1.4: provider-scoped identity keys are unique per tenant, not globally.
-- In a multi-tenant deployment every company runs its own gateway integration,
-- so the same provider name, transaction reference and virtual account number
-- are legitimate across companies. Global UNIQUE constraints let one tenant's
-- payment force a 500 (or an idempotency-suppression) on another tenant.

-- payments: idempotency/reference identity is (company_id, provider, ref).
ALTER TABLE payments
  DROP CONSTRAINT payments_provider_provider_txn_ref_key;
CREATE UNIQUE INDEX uniq_payments_company_provider_txn_ref
  ON payments (company_id, provider, provider_txn_ref);

-- virtual_accounts: account numbers belong to a company's provider integration.
ALTER TABLE virtual_accounts
  DROP CONSTRAINT virtual_accounts_provider_account_number_key;
CREATE UNIQUE INDEX uniq_va_company_provider_account
  ON virtual_accounts (company_id, provider, account_number);

-- webhook_events: event idempotency is scoped to the tenant that owns the event.
DROP INDEX uq_webhook_provider_event;
CREATE UNIQUE INDEX uq_webhook_provider_event
  ON webhook_events (company_id, provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- resolve_virtual_account resolves inside a tenant; without company scoping it
-- would be ambiguous once two companies use the same account number.
DROP FUNCTION resolve_virtual_account(text, text);
CREATE FUNCTION resolve_virtual_account(
  p_company_id uuid,
  p_provider text,
  p_account_number text
)
RETURNS TABLE (virtual_account_id uuid, customer_id uuid, company_id uuid, branch_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT va.id, va.customer_id, va.company_id, va.branch_id
  FROM virtual_accounts va
  WHERE va.company_id = p_company_id
    AND va.provider = p_provider
    AND va.account_number = p_account_number
    AND va.status = 'active'
$$;
REVOKE ALL ON FUNCTION resolve_virtual_account(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_virtual_account(uuid, text, text) TO nexora;