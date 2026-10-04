-- 0043_webhook_events_rls
-- RULE 1.6 / RULE 8.5.4 / RULE 14.5.2: webhook logs are company-and-branch
-- scoped. webhook_events previously sat in the 0010 RLS loop, but the
-- original Stage-1 loop (0010) had not yet been extended to it, so the
-- table carried table-level SELECT, INSERT grants to `nexora` with RLS
-- disabled and zero policies — a confirmed cross-tenant leak of raw
-- webhook payloads. This closes it with the same tenant policy shape as
-- every other company-scoped table, plus a platform-bypass policy so the
-- authorised support path (Part 20.1.5) can still inspect raw payloads
-- inside a bypass session.
--
-- NOTE: column-level GRANT UPDATE (payment_id) must be issued AFTER the
-- table-level REVOKE UPDATE: a table-level REVOKE UPDATE also clears any
-- column-level UPDATE grants the role holds on that table.

BEGIN;

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_tenant ON webhook_events;
CREATE POLICY rls_tenant ON webhook_events
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

DROP POLICY IF EXISTS rls_platform_bypass ON webhook_events;
CREATE POLICY rls_platform_bypass ON webhook_events
  USING (COALESCE(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (COALESCE(current_setting('app.bypass_rls', true), '') = 'on');

REVOKE UPDATE, DELETE ON webhook_events FROM nexora;
GRANT SELECT, INSERT ON webhook_events TO nexora;
GRANT UPDATE (payment_id) ON webhook_events TO nexora;

COMMIT;