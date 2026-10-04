-- Make webhook_signing_secrets upserts work under the app role.
--
-- 0017 granted only SELECT/INSERT/DELETE to `nexora`, but the payment-provider
-- sync uses "INSERT ... ON CONFLICT (company_id, provider) DO UPDATE", which
-- requires UPDATE privilege whenever a conflicting row is reached.
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_signing_secrets TO nexora;