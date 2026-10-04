-- RULE 10.6.2 — overdue cases escalate: the responsible worker, then the
-- Branch Manager, then recovery, then credit, then the MD, according to
-- thresholds and the company's configuration. Each level is recorded once
-- while it is open, so a case is never escalated twice at the same level.
CREATE TABLE overdue_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  escalation_level smallint NOT NULL CHECK (escalation_level BETWEEN 1 AND 5),
  level_name text NOT NULL,
  days_past_due integer NOT NULL CHECK (days_past_due >= 0),
  amount_due numeric(14,2) NOT NULL CHECK (amount_due >= 0),
  notified_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX uq_overdue_escalation_open
  ON overdue_escalations (company_id, loan_id, escalation_level)
  WHERE status = 'open';

CREATE INDEX idx_overdue_escalations_company
  ON overdue_escalations (company_id, status, raised_at DESC);

ALTER TABLE overdue_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE overdue_escalations FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON overdue_escalations
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON overdue_escalations AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT, UPDATE ON overdue_escalations TO nexora;
REVOKE DELETE ON overdue_escalations FROM nexora;
