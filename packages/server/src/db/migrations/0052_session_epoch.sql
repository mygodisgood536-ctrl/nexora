-- 0052_session_epoch
-- RULE 14.4.3 / 5.8.2 — suspension, portfolio hold and portfolio transfer
-- must kill the account's sessions IMMEDIATELY. Access tokens are stateless
-- JWTs valid for 15 minutes, so revoking only the refresh token leaves an
-- already-issued access token usable for the remainder of its life.
--
-- A per-user session epoch fixes this: the epoch is stamped into every access
-- token, and the authenticator refuses a token whose epoch is older than the
-- user's current one. Any security action bumps the epoch, which invalidates
-- every outstanding access token at once without a deny-list.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN users.session_epoch IS
  'Incremented on any session-invalidating action (suspend, hold, transfer, '
  'terminate, company suspension). Stamped into access tokens so revocation '
  'is immediate rather than waiting for the 15-minute expiry.';

COMMIT;
