BEGIN;

DROP POLICY IF EXISTS rls_tenant ON face_captures;
CREATE POLICY rls_tenant ON face_captures
  USING (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  )
  WITH CHECK (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  );

COMMIT;
