-- 0085_provider_secret_encryption.sql
--
-- RULE 14.5.1 - "Provider credentials, webhook secrets and authenticator seeds
-- are encrypted at rest, are never logged, never exported, never displayed
-- after saving except through an explicit authorised reveal, and never
-- included in support data."
--
-- Vision audit finding F-06: payment_provider_configs.api_key and
-- webhook_signing_secrets.secret held plaintext. A database read therefore
-- disclosed every company's live provider credentials, which is also
-- prohibition 22 (a provider secret shown in an export).
--
-- The application now writes AES-256-GCM ciphertext into these columns, bound
-- to the owning company as authenticated additional data. This migration adds
-- the fingerprint column the UI uses to show *which* key is configured
-- ("f3a2…") without decrypting it, and constrains the new format.
--
-- NOTE FOR DEPLOYMENT: existing rows hold plaintext and therefore cannot be
-- "converted" — a plaintext value was never encrypted, so re-wrapping it would
-- be a no-op that suggests a protection that is not there. There is no
-- deployed database in this environment; on any environment that has one,
-- every provider credential must be re-entered through the provider flow
-- before it can be used. This is deliberate and fail-closed.

ALTER TABLE payment_provider_configs
  ADD COLUMN IF NOT EXISTS api_key_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_ppc_company_provider
  ON payment_provider_configs (company_id, provider);

-- The stored secret must be ciphertext from now on. A plaintext-looking value
-- (no "v1." envelope) is rejected by the application before use.
COMMENT ON COLUMN payment_provider_configs.api_key IS
  'AES-256-GCM ciphertext of the provider API key, bound to company_id. Never plaintext.';
COMMENT ON COLUMN webhook_signing_secrets.secret IS
  'AES-256-GCM ciphertext of the webhook signing secret, bound to company_id. Never plaintext.';
COMMENT ON COLUMN payment_provider_configs.api_key_fingerprint IS
  'Non-reversible 8-character fingerprint used to identify which key is configured without revealing it.';