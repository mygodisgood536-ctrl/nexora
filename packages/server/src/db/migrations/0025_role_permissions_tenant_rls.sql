-- 0025_role_permissions_tenant_rls.sql
-- Stage 1 (§4 isolation) residual: the Stage 6 audit found role_permissions
-- completely outside tenant RLS. Migration 0010 enumerated roles and
-- role_assignments but omitted role_permissions, so the join table carried
-- only the plain DML grant from 0004 — any nexora session holding a role id
-- could read, and (worse during provisioning) the table was invisible to
-- branches through the tenant machinery. Tenant context is inherited from the
-- parent `roles` row exactly like role_assignment_branches inherits from
-- role_assignments (see 0014): role_permissions has no company_id of its own.
--
-- The policy mirrors the companies pattern (0010/0013): an explicit audited
-- bypass flag (app.bypass_rls='on', used by the Platform Owner console paths)
-- escapes the check, otherwise the parent role must belong to the session
-- company. Roles itself is tenant-scoped (0010), so the EXISTS subquery is
-- automatically narrowed to the session company.
--
-- Also grants nexora SELECT on platform_role_permission_bundles so the
-- workers/role engine can provision default verb bundles for a company's
-- built-in roles at runtime (State 6 role engine fix).

DROP POLICY IF EXISTS rls_tenant ON role_permissions;
CREATE POLICY rls_tenant ON role_permissions
  USING (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND r.company_id = app_current_company()
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND r.company_id = app_current_company()
    )
  );

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO nexora;
GRANT SELECT ON platform_role_permission_bundles TO nexora;