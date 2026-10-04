-- 0038_provider_connection_test
-- Vision Part 8 — provider activation law.
--
--  * A provider configuration may only be ACTIVATED after
--      (a) a successful connection test against the provider's API base URL, and
--      (b) MD authorisation (implicit when the MD/Deputy MD/GM/Finance makes the
--          change; an explicit queue item for IT/System Administrator changes).
--  * These columns record the connection-test outcome so activation is decided
--    on stored evidence rather than on a caller's assertion.

BEGIN;

ALTER TABLE payment_provider_configs
  ADD COLUMN IF NOT EXISTS connection_tested_at timestamptz,
  ADD COLUMN IF NOT EXISTS connection_test_ok boolean;

GRANT UPDATE (connection_tested_at, connection_test_ok) ON payment_provider_configs TO nexora;

-- A provider config that has not passed its connection test can never be active.
UPDATE payment_provider_configs SET is_active = false
 WHERE connection_test_ok IS DISTINCT FROM true;

COMMIT;
