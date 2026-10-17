-- 0089 - Attribute every audit entry to the role assignment that performed it.
--
-- RULE 14.3.1 requires the audit field set to carry "the role assignment used"
-- on EVERY entry, and RULE 18.17 requires that every action records which role
-- assignment was used. Until now only branch-workplace.enter wrote that column,
-- so a person holding several roles performed actions that were attributable to
-- a person but not to a duty.
--
-- Rather than thread a new argument through every audit writer, the column
-- defaults from the transaction's session GUC exactly like the tenant scope
-- already does in migration 0010. The request middleware stamps the active role
-- key once per request, so all thirty-plus audit writers pick it up
-- automatically and none of them can forget it.

CREATE FUNCTION app_current_role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.role_used', true), '')
$$;

ALTER TABLE audit_logs
  ALTER COLUMN role_used SET DEFAULT app_current_role();

-- RULE 14.3.1 also requires the branch where applicable. Several writers omit
-- branch_id while operating inside a branch context, so give the column the
-- same treatment the role column gets: fall back to the transaction's branch
-- when the writer did not name one explicitly.
ALTER TABLE audit_logs
  ALTER COLUMN branch_id SET DEFAULT app_current_branch();

-- RULE 3.7.1 - the platform audit trail carries session and IP metadata for
-- every platform-level action. 0002 created session_ip and user_agent but no
-- writer ever populated them; request_id is added so a platform action can be
-- correlated with the request that performed it.
ALTER TABLE platform_audit_logs
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id),
  ADD COLUMN IF NOT EXISTS role_used text;

-- RULE 3.7.2 / 14.3.2 - platform audit entries are append-only. The original
-- FK had no ON DELETE clause, which defaults to NO ACTION: discarding a company
-- draft failed outright because the platform trail already referenced it. The
-- reference is nulled instead, so the record of the discard survives the record
-- it concerns.
ALTER TABLE platform_audit_logs
  DROP CONSTRAINT IF EXISTS platform_audit_logs_company_id_fkey;
ALTER TABLE platform_audit_logs
  ADD CONSTRAINT platform_audit_logs_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

-- Same reason for the tenant trail. audit_logs.company_id is NOT NULL, so the
-- FK cannot be SET NULL; instead the draft-discard path archives the draft's
-- audit rows into platform_audit_logs BEFORE the company row is removed, so
-- RULE 14.3.2 ("audit entries are append-only, never deleted") is preserved
-- across the one case where a company record may legitimately go away.