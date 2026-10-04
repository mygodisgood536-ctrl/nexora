-- 0040 — Virtual-account updated_at + customer-portal read-path RLS bypass.
--
-- 1) virtual_accounts is created (0007) without an updated_at column, but
--    VA_SELECT in customers/service.ts returns created_at/updated_at for the
--    lifecycle surface. Add the column so VAs use the same audit shape as
--    every other mutable entity.
--
-- 2) The verified customer-portal reads (customer-portal/service.ts) run
--    under the audited withBypass path (app.bypass_rls='on') because the
--    portal JWT — not a session — is the credential. Their queries are
--    explicitly scoped to the token's company+customer. loans, savings,
--    payments, receipts and repayment rows were created (0010) with the
--    plain tenant-keyed policy, so under bypass they return zero rows; add
--    the same bypass read policy customers received (0032) and
--    customer_portal_access received (0033). Isolation is preserved by the
--    explicit WHERE customer_id/company_id scoping in the service.
ALTER TABLE virtual_accounts
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'loans',
    'repayment_schedule_rows',
    'savings_accounts',
    'payments',
    'receipts'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rls_bypass_scope ON %I', t);
    EXECUTE format(
      'CREATE POLICY rls_bypass_scope ON %I
         AS PERMISSIVE
         FOR SELECT
         USING (COALESCE(current_setting(''app.bypass_rls'', true), '''') = ''on'')',
      t
    );
  END LOOP;
END $$;