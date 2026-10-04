-- 0041 — virtual_accounts customer-portal RLS bypass read.
--
-- 0040 granted the verified portal read path (withBypass, app.bypass_rls='on')
-- on the tables the portal queries, but virtual_accounts is ALSO RLS-forced by
-- the 0010 loop and therefore returns zero rows for the portal's
-- virtual-account read. Same shape as every other portal read: the policy is
-- permissive FOR SELECT gated solely on the audited bypass flag; isolation is
-- preserved by the service's explicit customer_id/company_id scoping.
DROP POLICY IF EXISTS rls_bypass_scope ON virtual_accounts;
CREATE POLICY rls_bypass_scope ON virtual_accounts
  AS PERMISSIVE
  FOR SELECT
  USING (COALESCE(current_setting('app.bypass_rls', true), '') = 'on');