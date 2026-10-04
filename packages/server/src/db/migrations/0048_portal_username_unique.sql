-- 0048_portal_username_unique
-- RULE 5.2.4 — Customer Portal usernames are now the customer's full name.
-- Two customers in one company can share a full name, and the portal login
-- resolves `WHERE company = ? AND username = ?`; without uniqueness that
-- lookup is ambiguous and would let one same-named customer authenticate into
-- the other's records. The credential law requires the full name as the
-- username, so the collision must be refused at provisioning time rather than
-- resolved silently at login.
--
-- Scope is (company_id, username): the same full name may exist in two
-- different companies, which are fully isolated tenants.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_portal_access_company_username
  ON customer_portal_access (company_id, username);

COMMIT;
