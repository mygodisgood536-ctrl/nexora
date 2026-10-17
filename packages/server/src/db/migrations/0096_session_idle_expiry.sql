-- 0096 - Idle session expiry (Vision RULE 14.4.1).
--
-- RULE 14.4.1: "Sessions expire after the company's configured idle timeout,
-- and sensitive actions require re-verification with the authenticator."
--
-- `company_settings.session_timeout_minutes` has existed since migration 0037 and
-- was read by nothing, so a session stayed live indefinitely as long as the
-- bearer token was presented - the idle timeout the Vision requires was not
-- enforced anywhere.
--
-- `last_seen_at` is the fact the timeout is measured from. It is stamped by the
-- live-session guard on every authenticated request, so an idle session is
-- genuinely idle rather than merely unrefreshed.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_last_seen
  ON users (company_id, last_seen_at)
  WHERE last_seen_at IS NOT NULL;

-- A session is idle from the moment it is issued, so a token that has never
-- been used is measured from its login, not from NULL.
UPDATE users
   SET last_seen_at = COALESCE(last_login_at, created_at)
 WHERE last_seen_at IS NULL;