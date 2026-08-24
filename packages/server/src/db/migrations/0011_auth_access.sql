-- Stage 2: pre-auth host resolution must read the company registry.
-- companies sits outside the tenant-DML grant loop of 0010 (it is the
-- tenant registry itself); its RLS policy accepts app.bypass_rls='on',
-- so a plain SELECT grant is sufficient and safe for login resolution.
GRANT SELECT ON companies TO nexora;

-- Role-engine join tables carry no company_id of their own (tenant
-- containment flows through their RLS-scoped parents: roles and
-- role_assignments). The permission merge engine reads them inside an
-- established tenant session.
GRANT SELECT ON role_permissions TO nexora;
GRANT SELECT ON role_assignment_branches TO nexora;

-- Refresh-token rotation runs BEFORE any tenant context exists (the cookie
-- itself identifies the tenant), so its policy accepts the audited bypass
-- flag exactly like the companies registry policy above.
DROP POLICY IF EXISTS rls_tenant ON refresh_tokens;
CREATE POLICY rls_tenant ON refresh_tokens
  USING (
    company_id = app_current_company()
    OR COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
  )
  WITH CHECK (
    company_id = app_current_company()
    OR COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
  );
