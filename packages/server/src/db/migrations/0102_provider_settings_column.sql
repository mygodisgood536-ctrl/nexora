-- 0102 - Provider-specific configuration fields and deliberate sharing (RULE 8.6.1-3 / 8.6.1-2).
--
-- RULE 8.6.1-3: "A provider form with a fixed field set that ignores the chosen
-- provider" is prohibited.
--
-- RULE 8.6.1-2: a shared provider credential between two branches of the same
-- company is prohibited "unless the company deliberately configures one merchant
-- account for several branches and the platform records that fact explicitly."
--
-- provider_settings holds the provider-specific fields derived from the registry
-- row for the chosen provider (payment_providers.requirement_set), so the form
-- is generated per-provider instead of using one fixed field set.
--
-- is_shared_account records the deliberate sharing decision explicitly. Without
-- it, two branches pointing at one provider_config_id would look like a
-- violation of RULE 8.6.1-2; with it, the sharing is provably authorised.

ALTER TABLE payment_provider_configs
  ADD COLUMN IF NOT EXISTS provider_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_shared_account boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_provider_configs_shared
  ON payment_provider_configs (company_id, is_shared_account)
  WHERE is_shared_account;