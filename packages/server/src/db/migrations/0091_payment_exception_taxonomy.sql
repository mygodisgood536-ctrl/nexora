-- 0091 - Complete the payment exception taxonomy (RULE 10.5.5A / 8.5.5).
--
-- RULE 10.5.5A requires payment exceptions to explicitly support AT LEAST:
--   duplicate webhook, invalid webhook/signature, delayed webhook,
--   provider downtime/retry, unmatched payment, unallocated payment,
--   incomplete processing, reversed transaction, refund,
--   chargeback/dispute and reconciliation mismatch.
--
-- webhook_exceptions could only record three of those and reconciliation_items
-- only four, so six real failure modes had nowhere to go and were either
-- collapsed into a generic type or silently dropped. Each has its own reason,
-- owner, status, timestamps and audit trail once the types exist.
--
-- cross_branch_payload is added for RULE 8.5.2: a payload naming a virtual
-- account belonging to another branch than the endpoint it arrived on is a
-- first-class exception, and no record is written to that other branch.

ALTER TABLE webhook_exceptions
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id),
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id);

ALTER TABLE webhook_exceptions DROP CONSTRAINT IF EXISTS webhook_exceptions_exception_type_check;
ALTER TABLE webhook_exceptions ADD CONSTRAINT webhook_exceptions_exception_type_check
  CHECK (exception_type IN (
    -- RULE 8.5.5 - failed verification and malformed payloads.
    'invalid_signature',
    'malformed',
    'verification_failed',
    -- RULE 10.5.5A - the full mandatory set.
    'duplicate_webhook',
    'delayed_webhook',
    'provider_downtime',
    'unmatched',
    'unallocated',
    'incomplete_processing',
    'reversed',
    'refund',
    'chargeback',
    'reconciliation_mismatch',
    -- RULE 8.5.2 - endpoint/branch binding violation.
    'cross_branch_payload'
  ));

CREATE INDEX IF NOT EXISTS idx_webhook_exceptions_branch
  ON webhook_exceptions (company_id, branch_id, created_at DESC);

ALTER TABLE reconciliation_items
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id),
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id);

ALTER TABLE reconciliation_items DROP CONSTRAINT IF EXISTS reconciliation_items_item_type_check;
ALTER TABLE reconciliation_items ADD CONSTRAINT reconciliation_items_item_type_check
  CHECK (item_type IN (
    'unallocated_payment',
    'unmatched_payment',
    'reversed_transaction',
    'incomplete_processing',
    -- RULE 10.5.5A - the remaining mandatory exception kinds.
    'duplicate_webhook',
    'delayed_webhook',
    'provider_downtime',
    'refund',
    'chargeback',
    'dispute',
    'reconciliation_mismatch',
    'provider_only_transaction'
  ));

CREATE INDEX IF NOT EXISTS idx_reconciliation_branch
  ON reconciliation_items (company_id, branch_id, created_at DESC);