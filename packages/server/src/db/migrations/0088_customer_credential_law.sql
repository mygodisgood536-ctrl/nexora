-- 0088 - Customer Portal credential law (Vision Part 5, RULE 5.2.4 / 5.3.x).
--
-- RULE 5.2.4 applies the credential law to Customer Portal access exactly as it
-- applies to every worker: the username is the full name, the initial password
-- is the at-sign plus the first name, and that initial credential is a ONE-TIME
-- credential which dies the moment the password is changed. RULE 5.3.3 blocks
-- the account from reaching anything until the ritual completes.
--
-- Before this migration `customer_portal_access` held only a password hash and
-- a three-value status, so a customer's generated initial password stayed a
-- permanently valid login for the life of the loan. This closes that hole: the
-- portal now carries the same lifecycle state machine as `users`.
--
-- RULE 18.1 / 9.6.4: the customer authenticator is required BY DEFAULT because
-- the portal shows real money and real balances, and the MD may switch it off
-- for his company where his customer base genuinely cannot support an
-- authenticator application. The choice is recorded here as a company setting
-- and every change to it is audited by the company services.

ALTER TABLE customer_portal_access
  ADD COLUMN credential_state text NOT NULL DEFAULT 'credential_issued'
    CHECK (credential_state IN (
      'credential_issued',
      'ritual_in_progress',
      'secured',
      'credential_expired',
      'disabled'
    )),
  ADD COLUMN totp_secret_encrypted text,
  ADD COLUMN totp_verified_at timestamptz,
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN credential_issued_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN credential_expires_at timestamptz,
  ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0
    CHECK (failed_login_attempts >= 0),
  ADD COLUMN locked_until timestamptz,
  -- RULE 5.2.3c / 14.4.3 - the initial credential dies the instant the password
  -- changes. Stamping every outstanding portal session with the epoch means a
  -- change-password revokes them all immediately rather than waiting for a
  -- two-hour token to lapse.
  ADD COLUMN session_epoch integer NOT NULL DEFAULT 1;

CREATE INDEX idx_customer_portal_access_credential
  ON customer_portal_access (company_id, credential_state);

-- RULE 9.6.4 - on by default; the MD may switch it off per company and the
-- change is audit-logged by the company services that own company_settings.
ALTER TABLE company_settings
  ADD COLUMN customer_authenticator_required boolean NOT NULL DEFAULT true;

-- Portal reads are scoped by the tenant transaction already in place; the new
-- columns need no additional grants because the nexora role already holds
-- SELECT/UPDATE on this table from 0033.