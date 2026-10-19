-- 0101 - Give reconciliation_items the tenant policy it never had.
--
-- Migration 0017 ran
--     ALTER TABLE reconciliation_items ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE reconciliation_items FORCE ROW LEVEL SECURITY;
-- but no migration in the chain has ever created a policy on that table.
--
-- FORCE RLS subjects even the table owner to the policies, and a table with RLS
-- enabled and no policy has an empty policy set. That does not raise an error:
-- SELECT silently returns zero rows and INSERT fails with "new row violates
-- row-level security policy".
--
-- The consequence is that the entire reconciliation queue was dead. Every
-- signature or schema exception the webhook pipeline records, every amount
-- mismatch the diff finds, and every "the poll could not confirm this"
-- exception written by the RULE 8.5.6 scheduled poll would have been invisible
-- and unrecoverable. RULE 8.5.6 requires that anything found only on the
-- provider side raises an exception; with no policy, that exception could never
-- be read back by anyone.
--
-- The policies below follow the established convention (migration 0050,
-- correction_requests): one permissive tenant policy and one RESTRICTIVE branch
-- policy, so a branch-scoped session can only reach its own branch's items.

ALTER TABLE reconciliation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_tenant ON reconciliation_items;
CREATE POLICY rls_tenant ON reconciliation_items
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

DROP POLICY IF EXISTS rls_branch_scope ON reconciliation_items;
CREATE POLICY rls_branch_scope ON reconciliation_items AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );
  -- A NULL branch_id marks a company-wide exception - the scheduled provider
  -- poll writes those, because it reconciles a provider configuration rather
  -- than a branch's work. A branch-restricted session must not see them: they
  -- are the finance and audit surface, not a branch's exception queue. This
  -- matches the convention in migration 0050 exactly.