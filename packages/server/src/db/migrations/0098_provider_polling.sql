-- 0098 - Scheduled provider polling (Vision RULE 8.5.6).
--
-- RULE 8.5.6: "The platform must never rely only on webhooks: a scheduled
-- polling or reconciliation job must periodically confirm that every provider
-- transaction matches a recorded payment, and must raise an exception for
-- anything found only on the provider side."
--
-- The reconciliation diff (reconcileProviderTransactions) existed but nothing
-- ever called it: its own comment said "the actual provider pull is a separate
-- cron/worker", and that worker was never built. So every provider
-- configuration was, in practice, webhook-only, which is exactly what the rule
-- forbids.
--
-- These counters are separate from the webhook counters in migration 0090 on
-- purpose. A provider whose webhooks are 100% healthy can still be silently
-- dropping transactions, and only a real poll can detect that. Keeping the two
-- apart means "webhooks quiet" and "polling quiet" never mask each other.

ALTER TABLE payment_provider_configs
  ADD COLUMN IF NOT EXISTS last_poll_at timestamptz,
  ADD COLUMN IF NOT EXISTS poll_success_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poll_failure_count integer NOT NULL DEFAULT 0,
  -- The watermark the next poll resumes from. Advanced only after a poll that
  -- actually parsed, so a failed or unparseable poll re-reads the same window
  -- rather than skipping transactions that were in it.
  ADD COLUMN IF NOT EXISTS poll_watermark timestamptz;

-- RULE 8.5.5 / 8.3.2 - polling health is part of the provider's own health
-- record so a branch can see that its rail is actually being verified.
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS last_provider_poll_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_poll_failure_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_provider_configs_due_for_poll
  ON payment_provider_configs (company_id, last_poll_at)
  WHERE is_active;