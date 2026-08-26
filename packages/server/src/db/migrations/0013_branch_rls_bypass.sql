-- 0013_branch_rls_bypass
-- The Platform Owner's Branches Overview (Platform Owner Portal Spec §8) reads
-- structural branch fields through the audited bypass path (withBypass).
-- branches was created with the plain tenant-keyed policy, which has no
-- bypass escape, so that path failed closed with zero rows. Mirror the exact
-- companies pattern (0010) here: bypass flag OR own-company match.

DROP POLICY IF EXISTS rls_tenant ON branches;
CREATE POLICY rls_tenant ON branches
  USING (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  )
  WITH CHECK (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  );
