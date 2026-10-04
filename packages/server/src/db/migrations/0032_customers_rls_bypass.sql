-- 0032_customers_rls_bypass
-- The Customer Portal's pre-auth principal resolution (resolveCustomerPrincipal)
-- reads a customer by id through the audited bypass path (withBypass sets
-- app.bypass_rls='on'). customers was created (0010) with the plain tenant-keyed
-- rls_tenant policy, which has no bypass escape, so that path failed closed with
-- zero rows and the portal always returned 401 "Customer not found". Mirror the
-- exact branches pattern (0013) here: bypass flag OR own-company match.

DROP POLICY IF EXISTS rls_tenant ON customers;
CREATE POLICY rls_tenant ON customers
  USING (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  )
  WITH CHECK (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  );