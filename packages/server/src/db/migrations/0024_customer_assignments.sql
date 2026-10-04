-- 0024_customer_assignments.sql
-- Stage 7E — Collection Officer assignments (Part 1 §25-B/25-C).
-- The CO → customer / CO → group edge the Performance Calculation Engine
-- uses to scope a staff member's personal totals. This is pure assignment
-- metadata — it never carries money figures: every performance figure
-- derives from the payment pipeline and the repayment schedule (Part 1
-- §25-A/25-B), never from an assignment row.
CREATE TABLE customer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  staff_id uuid NOT NULL REFERENCES users(id),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','ended')),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_target_required CHECK (
    customer_id IS NOT NULL OR group_id IS NOT NULL
  ),
  CONSTRAINT assignment_target_exclusive CHECK (
    NOT (customer_id IS NOT NULL AND group_id IS NOT NULL)
  )
);
CREATE INDEX idx_assignments_staff_active
  ON customer_assignments (company_id, staff_id, status);
CREATE INDEX idx_assignments_customer_active
  ON customer_assignments (company_id, customer_id, status);
CREATE INDEX idx_assignments_group_active
  ON customer_assignments (company_id, group_id, status);

CREATE TRIGGER trg_customer_assignments_updated BEFORE UPDATE ON customer_assignments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE customer_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_assignments FORCE ROW LEVEL SECURITY;

-- Tenant policy mirrors 0010.
DROP POLICY IF EXISTS rls_tenant ON customer_assignments;
CREATE POLICY rls_tenant ON customer_assignments
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

-- Branch scoping mirrors 0010's branch-scoped tables: staff see assignment
-- rows for the branch their session is restricted to.
DROP POLICY IF EXISTS rls_branch_scope ON customer_assignments;
CREATE POLICY rls_branch_scope ON customer_assignments AS RESTRICTIVE
  USING (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  )
  WITH CHECK (
    COALESCE(current_setting('app.branch_restricted', true), '') <> 'on'
    OR branch_id = app_current_branch()
  );

GRANT SELECT, INSERT, UPDATE ON customer_assignments TO nexora;