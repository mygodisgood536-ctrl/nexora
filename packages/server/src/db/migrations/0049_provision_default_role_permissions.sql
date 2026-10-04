-- 0049_provision_default_role_permissions
-- The platform role catalogue (0016) defines a default verb bundle for every
-- built-in role, but each company carries its own `roles` / `role_permissions`
-- rows and nothing copied the bundle across. A role that held no verbs was
-- refused by every requirePermission gate — including the MD, which
-- createCompany provisions directly.
--
-- This backfills any company role that currently has NO permissions at all
-- from its platform bundle. A role that already holds permissions is left
-- untouched, so an MD-authorised narrowing via setRolePermissions is never
-- overwritten. Idempotent: re-running matches no rows.

BEGIN;

INSERT INTO role_permissions (role_id, verb)
SELECT r.id, b.verb
  FROM roles r
  JOIN platform_role_permission_bundles b ON b.role_key = r.role_key
 WHERE NOT EXISTS (
         SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id
       )
ON CONFLICT DO NOTHING;

COMMIT;
