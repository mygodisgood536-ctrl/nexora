-- 0037 — Identity and credential law (Vision Part 5, RULE 4.2/5.1-5.4).
--
-- Adds the credential lifecycle state machine to users, the mandatory
-- authenticator binding fields, lockout controls, profile-completion and
-- credential-issuance timestamps, plus the company-level policy knobs that
-- drive the ritual window and login lockout.
--
-- The existing `status` column (invited/active/suspended/terminated) is
-- retained as the coarse account status; `credential_state` is the Vision's
-- authoritative 9-state lifecycle. They are kept in sync by the services.

ALTER TABLE users
  ADD COLUMN credential_state text NOT NULL DEFAULT 'credential_issued'
    CHECK (credential_state IN (
      'credential_issued',
      'ritual_in_progress',
      'secured',
      'credential_expired',
      'frozen',
      'portfolio_on_hold',
      'transferred',
      'suspended',
      'terminated'
    )),
  ADD COLUMN totp_secret_encrypted text,
  ADD COLUMN totp_verified_at timestamptz,
  ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0
    CHECK (failed_login_attempts >= 0),
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN profile_completed_at timestamptz,
  ADD COLUMN passport_file_hash text,
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN credential_issued_at timestamptz,
  ADD COLUMN credential_expires_at timestamptz;

CREATE INDEX idx_users_credential_state ON users (company_id, credential_state);

-- Company-level policy knobs (Vision 5.2.3, 5.3, 5.10).
ALTER TABLE company_settings
  ADD COLUMN credential_ritual_window_hours integer NOT NULL DEFAULT 168
    CHECK (credential_ritual_window_hours > 0),
  ADD COLUMN password_min_length integer NOT NULL DEFAULT 8
    CHECK (password_min_length BETWEEN 6 AND 64),
  ADD COLUMN lockout_threshold integer NOT NULL DEFAULT 5
    CHECK (lockout_threshold BETWEEN 1 AND 20),
  ADD COLUMN lockout_minutes integer NOT NULL DEFAULT 15
    CHECK (lockout_minutes BETWEEN 1 AND 1440),
  ADD COLUMN session_timeout_minutes integer NOT NULL DEFAULT 480
    CHECK (session_timeout_minutes BETWEEN 5 AND 14400);

-- Existing rows reconcile onto the lifecycle. Active passwords that have
-- already been rotated are treated as fully secured; accounts still holding
-- an unconsumed temporary credential map to the credential_issued state.
UPDATE users
   SET credential_state = CASE
         WHEN status = 'terminated' THEN 'terminated'
         WHEN status = 'suspended'  THEN 'suspended'
         WHEN status = 'active' AND must_change_password = false THEN 'secured'
         WHEN status = 'active' AND must_change_password = true  THEN 'ritual_in_progress'
         ELSE 'credential_issued'
       END;

-- RLS is forced on users; new columns inherit the table privileges already
-- granted to nexora (0010_rls). No additional grants required.