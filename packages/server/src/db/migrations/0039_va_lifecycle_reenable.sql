-- 0039_va_lifecycle_reenable
-- Reconciles the schema with Vision V3.2 "Virtual Accounts are a disbursement
-- artifact" (RULE 9.5.1: a Virtual Account is issued at LOAN DISBURSEMENT,
-- never at registration):
--
--   1. customers.status: 'va_pending' is not a Vision status. A registered
--      customer is 'active' (RULE 9.5.2: registration creates the customer,
--      not a VA). The CHECK drops 'va_pending' and defaults to 'active';
--      any legacy 'va_pending' rows are migrated to 'active' (their KYC is
--      unaffected; the old pending-state customers were never blocked).
--   2. The two-argument security-definer resolve_virtual_account(text, text)
--      was dropped by migration 0022 when the three-argument, explicitly
--      company-scoped variant was introduced. Webhook processing and manual
--      tools still call the two-argument form for the "resolve by provider +
--      account number" operation. Recreate it scoped to the current tenant
--      session when one is set (app.company_id) and global otherwise so the
--      pre-auth manual lookup keeps working without a tenant session.

-- ---------------------------------------------------------------
-- 1. Customers: status is 'active' by default, no 'va_pending'.
-- ---------------------------------------------------------------
ALTER TABLE customers ALTER COLUMN status DROP DEFAULT;
UPDATE customers SET status = 'active' WHERE status = 'va_pending';
ALTER TABLE customers ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
ALTER TABLE customers ADD CONSTRAINT customers_status_check
  CHECK (status IN ('active','suspended','closed'));

-- ---------------------------------------------------------------
-- 2. Two-argument virtual-account resolver.
-- ---------------------------------------------------------------
DROP FUNCTION IF EXISTS resolve_virtual_account(text, text);
CREATE FUNCTION resolve_virtual_account(p_provider text, p_account_number text)
RETURNS TABLE (virtual_account_id uuid, customer_id uuid, company_id uuid, branch_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT va.id, va.customer_id, va.company_id, va.branch_id
  FROM virtual_accounts va
  WHERE va.provider = p_provider
    AND va.account_number = p_account_number
    AND va.status = 'active'
    AND (app_current_company() IS NULL OR va.company_id = app_current_company())
$$;

REVOKE ALL ON FUNCTION resolve_virtual_account(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_virtual_account(text, text) TO nexora;