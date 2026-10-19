-- 0084_platform_owner_authenticator_enrolment.sql
--
-- RULE 14.1.1 / RULE 14.2.1 - "the owner is not exempt from security" (Part 3).
-- Vision finding F-01: the Platform Owner had no way to enrol an
-- authenticator, and poLogin only demanded a second factor when a secret
-- already existed. A never-enrolled owner could therefore sign in with the
-- password alone, permanently.
--
-- The fix has two halves:
--   1. this migration adds the state that records whether the owner's
--      authenticator is enrolled, and an audit table for the transition;
--   2. the service refuses to issue a session until enrolment is complete,
--      and exposes setup/verify so the owner can complete it.
--
-- Existing owners are marked as NOT enrolled, which is the fail-closed choice:
-- the platform's most valuable account must present a second factor, so a
-- deployment upgrading from the previous build is required to enrol before
-- it can sign in. This is intentional and is called out in the final report.

ALTER TABLE platform_owners
  ADD COLUMN IF NOT EXISTS totp_enrolled_at timestamptz;

ALTER TABLE platform_owners
  ADD COLUMN IF NOT EXISTS totp_pending_secret text;

CREATE TABLE IF NOT EXISTS platform_owner_authenticator_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_owner_id uuid NOT NULL REFERENCES platform_owners(id) ON DELETE CASCADE,
  action text NOT NULL,
  previous_state jsonb,
  new_state jsonb,
  created_ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_auth_audit
  ON platform_owner_authenticator_audit (platform_owner_id, created_at DESC);

-- RULE 14.3.2 - security transitions are append-only; no UPDATE or DELETE is
-- granted on this table to the application role.
REVOKE UPDATE, DELETE ON platform_owner_authenticator_audit FROM PUBLIC;
REVOKE UPDATE, DELETE ON platform_owner_authenticator_audit FROM nexora;

-- The table is created after the blanket grant loop in migration 0010, so that
-- loop never granted the application role any privilege here. Revoking from
-- PUBLIC alone leaves the role with nothing at all: every write to this audit
-- trail would fail with "permission denied". The grant is what makes the
-- append-only story work, and the revoke immediately after it is what makes it
-- append-only rather than merely append-capable.
GRANT SELECT, INSERT ON platform_owner_authenticator_audit TO nexora;