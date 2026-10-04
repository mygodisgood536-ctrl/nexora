BEGIN;

CREATE TABLE company_ai_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  intent text NOT NULL,
  question text NOT NULL,
  answer jsonb NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_ai_query_log_company
  ON company_ai_query_log (company_id, created_at DESC);

ALTER TABLE company_ai_query_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_ai_query_log FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON company_ai_query_log
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON company_ai_query_log AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id IS NULL
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id IS NULL
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT ON company_ai_query_log TO nexora;
REVOKE UPDATE, DELETE ON company_ai_query_log FROM nexora;

COMMIT;
