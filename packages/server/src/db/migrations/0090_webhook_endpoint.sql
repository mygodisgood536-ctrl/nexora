-- 0090 - The system-generated webhook endpoint (RULE 8.5.1 / 8.5.2 / 8.6.1).
--
-- RULE 8.5.1 requires that the moment a provider becomes Active for a branch the
-- system generates the branch's webhook endpoint "uniquely and non-guessably,
-- scoped to that company, that branch and that provider", binds incoming
-- webhooks from that endpoint to that branch/provider/company automatically, and
-- nobody types or chooses it.
--
-- RULE 8.6.1-1 makes "a manually typed webhook URL, or a screen that lets a
-- person choose which branch a webhook belongs to" a hard prohibition. Until
-- now the ingress was the guessable path /webhooks/payments/{provider} and the
-- tenant was selected by a caller-supplied X-Nexora-Company header, so the
-- endpoint itself scoped nothing.
--
-- This adds an opaque per-configuration endpoint token. It is the tenant and
-- branch binding: the endpoint alone determines which company, branch and
-- provider a webhook belongs to, so an operator cannot choose the binding and a
-- third party cannot guess another tenant's endpoint.

ALTER TABLE payment_provider_configs
  ADD COLUMN IF NOT EXISTS webhook_endpoint_token text,
  ADD COLUMN IF NOT EXISTS webhook_endpoint_path text,
  -- RULE 8.4.4 - a branch may hold more than one provider and must always know
  -- which one is primary for creating new virtual accounts.
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Every configuration receives an endpoint, including existing rows, so a
-- provider that was configured before this migration still gets a real,
-- non-guessable endpoint rather than staying on the guessable path.
UPDATE payment_provider_configs
   SET webhook_endpoint_token = encode(gen_random_bytes(32), 'base64url')
 WHERE webhook_endpoint_token IS NULL;

UPDATE payment_provider_configs
   SET webhook_endpoint_path = '/api/v1/webhooks/payments/endpoint/' || webhook_endpoint_token
 WHERE webhook_endpoint_path IS NULL OR webhook_endpoint_path <> '/api/v1/webhooks/payments/endpoint/' || webhook_endpoint_token;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_config_webhook_token
  ON payment_provider_configs (webhook_endpoint_token)
  WHERE webhook_endpoint_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_config_branch
  ON payment_provider_configs (company_id, branch_id, provider)
  WHERE branch_id IS NOT NULL;

-- At most one primary provider per branch, so the branch always knows which
-- provider creates new virtual accounts (RULE 8.4.4).
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_config_primary_per_branch
  ON payment_provider_configs (company_id, branch_id)
  WHERE is_primary AND branch_id IS NOT NULL;

-- RULE 8.5.5 / 8.3.2 - health counters and the last webhook received belong to
-- the branch's own health record, not just to the company-level configuration.
ALTER TABLE payment_provider_configs
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_success_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS webhook_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS webhook_retry_count integer NOT NULL DEFAULT 0;