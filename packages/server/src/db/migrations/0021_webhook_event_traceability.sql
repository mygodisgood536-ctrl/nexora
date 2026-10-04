-- 0021: Webhook traceability (§25 full traceability chain).
--
-- webhook_events previously had no company or payment link, so the
-- audit-trail chain "Payment → Webhook → ..." could not be traversed by
-- foreign key (Part 1 §21; Part 1 §25 'every link is a foreign key, not a
-- report-time join guess'). Add tenant scope and the payment link, and give
-- payments the reverse pointer so the chain is navigable from either end.

ALTER TABLE webhook_events
  ADD COLUMN company_id uuid REFERENCES companies(id),
  ADD COLUMN payment_id uuid REFERENCES payments(id);

CREATE INDEX idx_webhook_events_company ON webhook_events (company_id);
CREATE INDEX idx_webhook_events_payment ON webhook_events (payment_id);

ALTER TABLE payments
  ADD COLUMN webhook_event_id uuid REFERENCES webhook_events(id);
CREATE INDEX idx_payments_webhook_event ON payments (webhook_event_id);

-- payments is append-only for the app role (0010 revokes UPDATE, keeping only
-- the status column); open the traceability column the same way (0017/0019).
GRANT UPDATE (webhook_event_id) ON payments TO nexora;