-- 0028_worker_visits.sql
-- Collection / field worker activity notes (Role Specs ROLE 28-31, Part 1 §25-B).
-- A "visit" is an activity note — never a payment record. It lets a Collection
-- Officer / Field Account Officer / Recovery Officer mark a customer or group
-- as visited / followed-up while documenting the visit text. Every figure that
-- involves money continues to come exclusively from the payment pipeline.
CREATE TABLE worker_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  worker_id uuid NOT NULL REFERENCES users(id),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE,
  visit_type text NOT NULL CHECK (visit_type IN ('visited','followed_up','other')),
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 1000),
  visited_on timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_target_required CHECK (customer_id IS NOT NULL OR group_id IS NOT NULL),
  CONSTRAINT visit_target_exclusive CHECK (NOT (customer_id IS NOT NULL AND group_id IS NOT NULL))
);
CREATE INDEX idx_worker_visits_worker ON worker_visits (company_id, worker_id, visited_on);
CREATE INDEX idx_worker_visits_customer ON worker_visits (company_id, customer_id);
CREATE INDEX idx_worker_visits_group ON worker_visits (company_id, group_id);

ALTER TABLE worker_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_visits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_tenant ON worker_visits;
CREATE POLICY rls_tenant ON worker_visits
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

DROP POLICY IF EXISTS rls_branch_scope ON worker_visits;
CREATE POLICY rls_branch_scope ON worker_visits AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT ON worker_visits TO nexora;