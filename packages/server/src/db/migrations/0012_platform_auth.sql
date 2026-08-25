-- Stage 3: platform-owner sessions share the refresh-token store but are not
-- tenant-scoped, so company_id becomes nullable and the owning principal is
-- recorded explicitly (exactly one of the two columns per row).
ALTER TABLE refresh_tokens ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE refresh_tokens ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE refresh_tokens ADD COLUMN platform_owner_id uuid REFERENCES platform_owners(id);
ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_token_principal_check
  CHECK ((company_id IS NOT NULL) <> (platform_owner_id IS NOT NULL));
CREATE INDEX idx_refresh_tokens_platform ON refresh_tokens (platform_owner_id, revoked_at);

-- Platform Owner portal access for the application role. All PO queries run
-- through the audited bypass path (withBypass); RLS does not apply to these
-- platform tables, so explicit grants are the access boundary here.
GRANT SELECT, UPDATE ON platform_owners TO nexora;
GRANT SELECT, INSERT, UPDATE ON companies TO nexora;
GRANT INSERT ON themes TO nexora;
GRANT INSERT ON company_settings TO nexora;
GRANT INSERT ON company_counters TO nexora;
GRANT INSERT ON company_enabled_roles TO nexora;
GRANT SELECT ON platform_role_catalogue TO nexora;
GRANT INSERT, UPDATE, SELECT ON support_access_sessions TO nexora;
GRANT INSERT, SELECT ON platform_audit_logs TO nexora;
GRANT INSERT, UPDATE, SELECT ON platform_announcements TO nexora;
GRANT SELECT, UPDATE ON global_settings TO nexora;

-- Company-scaffolding tables are written by the Platform Owner through the
-- audited bypass path before any tenant session exists; their policies must
-- accept the same audited bypass flag as companies itself.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['themes','company_settings','company_counters','company_enabled_roles','support_access_sessions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rls_tenant ON %I', t);
    EXECUTE format(
      'CREATE POLICY rls_tenant ON %I
         USING (
           company_id = app_current_company()
           OR COALESCE(current_setting(''app.bypass_rls'', true), '''') = ''on''
         )
         WITH CHECK (
           company_id = app_current_company()
           OR COALESCE(current_setting(''app.bypass_rls'', true), '''') = ''on''
         )',
      t
    );
  END LOOP;
END $$;
