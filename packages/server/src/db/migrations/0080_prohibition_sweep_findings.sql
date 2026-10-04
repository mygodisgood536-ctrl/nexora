-- Stage 13 Pass 2 findings (Vision Part 15 prohibitions 10 and 20,
-- RULE 8.4.1, RULE 11.2.1 bookkeeping, RULE 3.4.1).
--
-- 1. configure_providers. RULE 8.4.1 names who may make a provider change:
--    the MD applies immediately; Deputy MD, GM and Finance save in
--    "awaiting MD authorisation". The payment service already enforced exactly
--    that list, but the route gate in front of it required the coarse
--    "configure" verb, which the role bundles grant to Head Office
--    Administrator and IT/System Administrator and NOT to Deputy MD, GM or the
--    GM family. So the real rule was unreachable for the people the vision
--    names, and reachable for the ones it forbids (12.7 "Providers (view)"
--    and "Cannot: authorise provider changes"; 12.23 "Cannot ... approve a
--    provider business change reserved for MD/Deputy MD/GM/Finance").
--    configure_providers is that exact authority, and nothing wider.
--    IT keeps "configure" for the technical credential flow it is allowed.
--
-- 2. DELETE is revoked from the application role on every financial, evidence
--    and identity-history table. Prohibition 10 forbids a delete control over
--    a financial record or an audit entry; a table grant is a delete control
--    whether or not a route currently exposes it. The application never
--    deletes from these tables - every lifecycle change is a status, a
--    reversal or a new linked record (RULE 20.3.1).
--
-- 3. The company's generated portal URL is stored, not merely derived, so the
--    onboarding record is authoritative (RULE 3.4.1).

INSERT INTO permission_verbs (verb)
VALUES ('configure_providers')
ON CONFLICT (verb) DO NOTHING;

INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('md', 'configure_providers'),
  ('deputy_md', 'configure_providers'),
  ('gm', 'configure_providers'),
  ('assistant_gm', 'configure_providers'),
  ('operations_manager', 'configure_providers'),
  ('finance_manager', 'configure_providers')
ON CONFLICT (role_key, verb) DO NOTHING;

-- Financial truth, evidence and identity history: no destructive delete.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'approval_chains',
    'approval_chain_steps',
    'branch_payment_accounts',
    'customer_portal_access',
    'customers',
    'gl_accounts',
    'loan_applications',
    'loan_documents',
    'loan_products',
    'payment_provider_configs',
    'reconciliation_items',
    'users',
    'webhook_exceptions'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE DELETE ON TABLE public.%I FROM nexora', t);
    END IF;
  END LOOP;
END
$$;

-- RULE 3.4.1 - the generated company URL is part of the onboarding record.
UPDATE companies
   SET portal_url = slug || '.nexora.app'
 WHERE portal_url IS NULL
   AND slug IS NOT NULL;
