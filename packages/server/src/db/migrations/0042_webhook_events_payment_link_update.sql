-- 0042 — webhook_events.payment_id UPDATE grant for the verified-event linking.
--
-- 0010 grants nexora SELECT, INSERT on webhook_events and fully REVOKEs
-- UPDATE/DELETE. routes.ts (dispatchVerifiedWebhook) links an accepted (and
-- signature-verified) webhook event to the payment it produced by setting
-- payment_id. That is traceability-housekeeping, not a financial edit, so it
-- needs only a column-scoped UPDATE rather than opening the whole table.
GRANT UPDATE (payment_id) ON webhook_events TO nexora;