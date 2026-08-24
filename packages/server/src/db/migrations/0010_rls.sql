CREATE FUNCTION app_current_company() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;

CREATE FUNCTION app_current_branch() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.branch_id', true), '')::uuid
$$;

ALTER TABLE group_members
  ADD COLUMN company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX idx_group_members_company ON group_members (company_id);
UPDATE group_members gm SET company_id = g.company_id FROM groups g WHERE gm.group_id = g.id;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches','users','customers','groups','group_members','roles',
    'role_assignments','refresh_tokens','themes','company_settings',
    'company_enabled_roles','company_counters','loan_products',
    'approval_chains','approval_chain_steps','loan_applications',
    'loan_documents','credit_assessments','loans','repayment_schedule_rows',
    'virtual_accounts','payments','payment_allocations','payment_reversals',
    'webhook_exceptions','pipeline_jobs','savings_accounts',
    'savings_transactions','gl_accounts','journal_entries','journal_lines',
    'receipts','reconciliation_items','audit_logs','notifications',
    'support_access_sessions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS rls_tenant ON %I', t);
    EXECUTE format(
      'CREATE POLICY rls_tenant ON %I
         USING (company_id = app_current_company())
         WITH CHECK (company_id = app_current_company())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nexora', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers','groups','loans','loan_applications',
    'virtual_accounts','payments','savings_accounts'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rls_branch_scope ON %I', t);
    EXECUTE format(
      'CREATE POLICY rls_branch_scope ON %I AS RESTRICTIVE
         USING (
           COALESCE(current_setting(''app.branch_restricted'', true), '''') <> ''on''
           OR branch_id = app_current_branch()
         )
         WITH CHECK (
           COALESCE(current_setting(''app.branch_restricted'', true), '''') <> ''on''
           OR branch_id = app_current_branch()
         )',
      t
    );
  END LOOP;
END $$;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_companies ON companies;
CREATE POLICY rls_companies ON companies
  USING (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR id = app_current_company()
  )
  WITH CHECK (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR id = app_current_company()
  );

GRANT EXECUTE ON FUNCTION app_current_company() TO nexora;
GRANT EXECUTE ON FUNCTION app_current_branch() TO nexora;

REVOKE UPDATE, DELETE ON credit_assessments FROM nexora;
REVOKE UPDATE, DELETE ON payment_allocations FROM nexora;
REVOKE UPDATE, DELETE ON payment_reversals FROM nexora;
REVOKE UPDATE, DELETE ON savings_transactions FROM nexora;
REVOKE UPDATE, DELETE ON journal_entries FROM nexora;
REVOKE UPDATE, DELETE ON journal_lines FROM nexora;
REVOKE UPDATE, DELETE ON receipts FROM nexora;
REVOKE UPDATE, DELETE ON audit_logs FROM nexora;
REVOKE DELETE ON loans FROM nexora;
REVOKE DELETE ON repayment_schedule_rows FROM nexora;
REVOKE DELETE ON virtual_accounts FROM nexora;
REVOKE DELETE ON savings_accounts FROM nexora;

REVOKE UPDATE ON payments FROM nexora;
GRANT UPDATE (status) ON payments TO nexora;
REVOKE DELETE ON payments FROM nexora;

GRANT SELECT, INSERT ON webhook_events TO nexora;
REVOKE UPDATE, DELETE ON webhook_events FROM nexora;

CREATE FUNCTION resolve_virtual_account(p_provider text, p_account_number text)
RETURNS TABLE (virtual_account_id uuid, customer_id uuid, company_id uuid, branch_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT va.id, va.customer_id, va.company_id, va.branch_id
  FROM virtual_accounts va
  WHERE va.provider = p_provider
    AND va.account_number = p_account_number
    AND va.status = 'active'
$$;

REVOKE ALL ON FUNCTION resolve_virtual_account(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_virtual_account(text, text) TO nexora;

