-- 0014_role_assignment_branches_rls.sql
-- Stage 6 (workers + role assignments) inserts branch-scoped assignment rows
-- into role_assignment_branches (migration 0004). Migration 0010 enumerated
-- role_assignments but omitted role_assignment_branches, so the table was left
-- without any GRANT to the app role `nexora`, causing "permission denied for
-- table role_assignment_branches" (42501) when the workers service writes the
-- branch links.
--
-- role_assignment_branches is a pure join table (assignment_id + branch_id
-- only, no company_id column): tenant isolation is inherited from its parent
-- role_assignments.company_id, so no company-scoped RLS policy is added here.
-- We add DML grants and a restrictive branch-scope policy mirroring 0010's
-- rls_branch_scope so branch-narrowed sessions still see/allow only their
-- branch links.

-- The app role performs INSERT/UPDATE/DELETE on this join table.
GRANT SELECT, INSERT, UPDATE, DELETE ON role_assignment_branches TO nexora;

-- Restrictive branch-scope policy mirrors 0010's rls_branch_scope intent: when
-- the session narrows to a branch (app.branch_restricted = 'on'), only links
-- belonging to that branch remain visible. The branch id lives on this join
-- table itself (role_assignments has no branch_id column), so the policy
-- compares the row's own branch_id directly to the session branch — no
-- cross-table subquery, no recursion.
DROP POLICY IF EXISTS rls_branch_scope ON role_assignment_branches;
CREATE POLICY rls_branch_scope ON role_assignment_branches AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
  );

-- Keep RLS armed on this join table (matches the tenant-machinery intent).
-- Permissive tenant policy: a link is visible/insertable only when its parent
-- role_assignment is in the session company. Company scoping lives on the
-- parent (role_assignments.company_id), so this policy derives it from there.
-- Referencing role_assignments in USING/WITH CHECK is safe (different table,
-- no recursion), and its own tenant RLS restricts that subquery to the same
-- company.
DROP POLICY IF EXISTS rls_tenant ON role_assignment_branches;
CREATE POLICY rls_tenant ON role_assignment_branches
  USING (
    EXISTS (
      SELECT 1 FROM role_assignments ra
      WHERE ra.id = role_assignment_branches.assignment_id
        AND ra.company_id = app_current_company()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM role_assignments ra
      WHERE ra.id = role_assignment_branches.assignment_id
        AND ra.company_id = app_current_company()
    )
  );

ALTER TABLE role_assignment_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignment_branches FORCE ROW LEVEL SECURITY;