-- 0027_webhook_exceptions_harden.sql
-- Stage 7 fix: harden webhook_exceptions table (Part 1 §21 / §25).
-- 1. detail column must not be null — every exception must carry a reason.
-- 2. Add composite indexes for common query patterns.

-- Make detail NOT NULL (default empty JSON for existing rows)
UPDATE webhook_exceptions SET detail = '{}' WHERE detail IS NULL;
ALTER TABLE webhook_exceptions ALTER COLUMN detail SET NOT NULL;

-- Index for tenant-scoped list by resolved status (used by listWebhookExceptions)
CREATE INDEX IF NOT EXISTS idx_webhook_exceptions_company_resolved
  ON webhook_exceptions (company_id, resolved, created_at DESC);

-- Index for tenant-scoped list by provider + exception_type
CREATE INDEX IF NOT EXISTS idx_webhook_exceptions_company_provider_type
  ON webhook_exceptions (company_id, provider, exception_type, created_at DESC);

-- Index for reconciliation workflow: find exceptions by provider_txn_ref via detail
-- detail is stored as text (JSON string), cast to jsonb for the ? operator
CREATE INDEX IF NOT EXISTS idx_webhook_exceptions_detail_txn_ref
  ON webhook_exceptions ((detail::jsonb ->> 'provider_txn_ref'))
  WHERE detail::jsonb ? 'provider_txn_ref';