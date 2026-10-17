-- 0093 - Correct the authority bundles that contradicted the Vision.
--
-- RULE 18.6 / 7.7.2 / RULE 8.4.1 / 12.4 / 12.5 - only MD, Deputy MD, GM and
-- Finance may add, edit, remove or change a branch's payment provider.
--
-- Migration 0080 granted `configure_providers` to assistant_gm and
-- operations_manager, which RULE 12.4 and 12.5 explicitly forbid ("Cannot:
-- approve provider changes on their own"), while omitting the rest of the
-- Finance family that RULE 18.6 names. The service's own PROVIDER_CHANGE_ROLES
-- check masked this, so it was latent rather than a live breach - but the
-- permission the API answers to must itself be correct.
--
-- RULE 18.4 - "Who may create a branch? MD, HR, GM, Assistant GM, Operations
-- Manager, Assistant Operations Manager and Head Office Administrator." Deputy
-- MD was not in that list and is not granted it here; a Deputy MD stands in for
-- the MD, and branch creation is company-defining unless the MD delegates it
-- (RULE 12.2), which is recorded as an assignment-level grant rather than a
-- blanket role permission.

DELETE FROM platform_role_permission_bundles
 WHERE verb = 'configure_providers'
   AND role_key IN ('assistant_gm','operations_manager');

INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  -- RULE 18.6 / 7.7.2: the provider-change group.
  ('md','configure_providers'),
  ('deputy_md','configure_providers'),
  ('gm','configure_providers'),
  ('finance_manager','configure_providers'),
  ('accountant','configure_providers'),
  ('assistant_accountant','configure_providers'),
  ('cash_bank_reconciliation_officer','configure_providers')
ON CONFLICT (role_key, verb) DO NOTHING;

-- RULE 8.8.1 - IT and System Administrator owns the technical
-- provider-credential and integration duty: it may set, replace and rotate
-- provider credentials through the technical credential flow, audit-logged and
-- still subject to MD authorisation where the underlying configuration requires
-- it. That is a narrower power than changing a branch's provider, so it gets its
-- own verb rather than the business-change verb.
INSERT INTO permission_verbs (verb)
VALUES ('rotate_provider_credentials')
ON CONFLICT (verb) DO NOTHING;

INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES ('md','rotate_provider_credentials'), ('it_system_administrator','rotate_provider_credentials')
ON CONFLICT (role_key, verb) DO NOTHING;

DELETE FROM platform_role_permission_bundles
 WHERE verb = 'create_branch'
   AND role_key = 'deputy_md';