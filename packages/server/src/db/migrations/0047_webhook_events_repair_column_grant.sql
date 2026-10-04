-- 0047_webhook_events_repair_column_grant
-- Repair: an earlier revision of 0043 issued table-level
-- REVOKE UPDATE, DELETE AFTER the column-level GRANT UPDATE (payment_id).
-- A table-level REVOKE UPDATE also clears the role's column-level UPDATE
-- grants on that table, which broke the webhook traceability UPDATE at
-- routes.ts ("UPDATE webhook_events SET payment_id=..."). Re-issue the
-- column-level grant after the table-level revokes.

BEGIN;

REVOKE UPDATE, DELETE ON webhook_events FROM nexora;
GRANT SELECT, INSERT ON webhook_events TO nexora;
GRANT UPDATE (payment_id) ON webhook_events TO nexora;

COMMIT;