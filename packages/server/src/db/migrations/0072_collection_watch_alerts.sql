-- RULE 6.4.2 / 9.9.1 / 9.9.2 — the collection watch raises notifications for
-- money received but not allocated in time, a customer who has not paid for a
-- full cycle window, a group that has stopped paying entirely, and a worker's
-- performance below target. Each raised item is recorded so it is never
-- raised twice for the same reason, and notifications reach both the
-- responsible worker and the people who manage workers.
CREATE TABLE collection_watch_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  alert_kind text NOT NULL CHECK (alert_kind IN (
    'payment_awaiting_allocation',
    'customer_missed_full_cycle',
    'group_silent',
    'worker_below_target'
  )),
  subject_type text NOT NULL CHECK (subject_type IN ('payment','customer','group','worker')),
  subject_id uuid NOT NULL,
  responsible_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX uq_collection_watch_alert_subject
  ON collection_watch_alerts (company_id, alert_kind, subject_type, subject_id)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_collection_watch_alerts_company
  ON collection_watch_alerts (company_id, raised_at DESC);

ALTER TABLE collection_watch_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_watch_alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON collection_watch_alerts
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

CREATE POLICY rls_branch_scope ON collection_watch_alerts AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT, UPDATE ON collection_watch_alerts TO nexora;
REVOKE DELETE ON collection_watch_alerts FROM nexora;
