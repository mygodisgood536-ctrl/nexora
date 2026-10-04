-- Vision v3.9 FINAL: RULE 21.1.6 - 21.1.15 (OpenCode as the real
-- provider/model integration and execution layer) and RULE 21.3
-- (company-scoped AI execution).
--
-- A company's AI configuration is a first-class, company-scoped record. The
-- Platform Owner selects a provider and model for that company; the selection
-- is verified for real before it may become active, and it is the same record
-- the company-side execution path reads. The credential is stored encrypted
-- and is bound to the company, so it can never be replayed for another tenant.

CREATE TABLE company_ai_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  model_id text NOT NULL,
  api_key_encrypted text,
  api_key_fingerprint text,
  verification_state text NOT NULL DEFAULT 'unverified'
    CHECK (verification_state IN ('unverified', 'verified', 'failed', 'revoked')),
  verification_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  created_by_platform_owner uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_ai_configurations IS
  'RULE 21.1.9 - the exact provider/model a company''s AI uses, persisted and used by the real execution path.';

CREATE INDEX idx_company_ai_configurations_company
  ON company_ai_configurations (company_id, created_at DESC);

-- At most one ACTIVE configuration per company, enforced by the database so
-- two concurrent Done actions can never both believe they activated theirs
-- (RULE 3.8.5, RULE 21.1.13).
CREATE UNIQUE INDEX uniq_company_ai_active
  ON company_ai_configurations (company_id)
  WHERE is_active;

ALTER TABLE company_ai_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_ai_configurations FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON company_ai_configurations
  USING (
    company_id = app_current_company()
    OR COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
  )
  WITH CHECK (
    company_id = app_current_company()
    OR COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
  );

-- The table is company-scoped and has no branch, so no branch policy applies.
-- The Platform Owner's privileged path is admitted by the bypass clause above.

-- The Platform Owner provisions, verifies and activates through the platform's
-- privileged path. The application role may insert and update a configuration
-- (no company-side route exposes a write, and RLS still bounds it to one
-- company), but it can never delete one: a configuration's history is
-- preserved, and removal is the audited revoke flow.
GRANT SELECT, INSERT, UPDATE ON company_ai_configurations TO nexora;
REVOKE DELETE ON company_ai_configurations FROM nexora;

-- Every real execution is recorded against the company that made it, with the
-- provider/model actually used and the real outcome. No secret is ever stored.
CREATE TABLE company_ai_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  configuration_id uuid REFERENCES company_ai_configurations(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_id text NOT NULL,
  model_id text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome text NOT NULL CHECK (outcome IN ('answered', 'failed', 'refused')),
  failure_reason text,
  session_id text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(14, 6),
  latency_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_ai_executions_company
  ON company_ai_executions (company_id, created_at DESC);

ALTER TABLE company_ai_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_ai_executions FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON company_ai_executions
  USING (
    company_id = app_current_company()
    OR COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
  )
  WITH CHECK (
    company_id = app_current_company()
    OR COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
  );

CREATE POLICY rls_branch_scope ON company_ai_executions AS RESTRICTIVE
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

-- RULE 20.3.1 - an execution record is history; it is written once and read.
GRANT SELECT, INSERT ON company_ai_executions TO nexora;
REVOKE UPDATE, DELETE ON company_ai_executions FROM nexora;
