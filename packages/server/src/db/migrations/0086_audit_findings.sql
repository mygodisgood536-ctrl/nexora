-- 0086_audit_findings.sql
--
-- PART 12 §12.14 Internal Auditor and §12.15 Audit Officer:
--   "record findings and annotations" / "Audit hub ... findings".
-- The CapabilityPage previously reported findings as "not implemented", which was
-- true of the backend: no table, no endpoint, no surface.
--
-- A finding is an auditor's own conclusion attached to a record they inspected.
-- It is NOT a financial record and NOT part of the ledger. It carries:
--   - who raised it, and in what role they were acting (RULE 14.3.1)
--   - what it is about (entity type + id), so it can be navigated to
--   - a severity and a lifecycle status
--   - a free-text observation, and an optional remediation note
--
-- Findings are append-only in the same spirit as the audit trail (RULE 14.3.2):
-- there is no UPDATE or DELETE grant. The only mutation permitted is moving the
-- lifecycle forward (open -> acknowledged -> closed) which is written as a new
-- row in audit_findings_events, preserving the full history of the finding.

CREATE TABLE audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  raised_by uuid NOT NULL REFERENCES users(id),
  raised_as_role text,
  reference text NOT NULL,
  title text NOT NULL,
  observation text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('observation', 'low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'closed')),
  entity_type text,
  entity_id uuid,
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  remediation_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_findings_company
  ON audit_findings (company_id, created_at DESC);
CREATE INDEX idx_audit_findings_status
  ON audit_findings (company_id, status);
CREATE INDEX idx_audit_findings_entity
  ON audit_findings (company_id, entity_type, entity_id);

-- Lifecycle history: a finding's status moves forward, and every move is kept.
CREATE TABLE audit_findings_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES audit_findings(id) ON DELETE CASCADE,
  event text NOT NULL,
  previous_status text,
  new_status text,
  note text,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_findings_events_finding
  ON audit_findings_events (finding_id, created_at);

-- Tenancy: enforced at the data layer, exactly like every other company table.
ALTER TABLE audit_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_findings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_tenant ON audit_findings;
CREATE POLICY rls_tenant ON audit_findings
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

ALTER TABLE audit_findings_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_findings_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_tenant ON audit_findings_events;
CREATE POLICY rls_tenant ON audit_findings_events
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

-- RULE 14.3.2 - append-only. Nothing may delete a finding or its history.
REVOKE DELETE ON audit_findings FROM PUBLIC;
REVOKE DELETE ON audit_findings_events FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_findings FROM nexora;
REVOKE UPDATE, DELETE ON audit_findings_events FROM nexora;

-- Both tables are created after the blanket grant loop in migration 0010, so
-- that loop granted the application role nothing on them. Revoking from PUBLIC
-- alone leaves the role with no privilege at all, and every write to the
-- findings trail would fail with "permission denied" - which presents as an
-- application bug rather than a missing migration grant. The grant is what makes
-- findings recordable at all; the revokes immediately above are what make the
-- trail append-only rather than merely append-capable.
GRANT SELECT, INSERT ON audit_findings TO nexora;
GRANT SELECT, INSERT ON audit_findings_events TO nexora;

-- The severity a company sees is its own; it is not a global semantic colour
-- requirement, so no constraint links it to the accent (RULE 13.2).
COMMENT ON TABLE audit_findings IS
  'Auditor findings and annotations (Part 12 s12.14). Append-only; lifecycle moves are recorded in audit_findings_events.';