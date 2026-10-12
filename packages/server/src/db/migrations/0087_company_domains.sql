-- ============================================================================
-- 0087_company_domains.sql
--
-- Vision Part 1 §2.3 / the Create Company wizard's "Company domain" field:
--   "Company domain: Optional custom domain. Validated as a proper domain and
--    checked for conflicts. If left empty, the system's generated company URL is
--    used and a custom domain can be attached later."
--
-- RULE 2.3.1: the custom domain is "pointed at the same application and never
-- changes the internal slug". So this table is a POINTER table, never an
-- identity table — companies.slug remains the immutable tenant key, and every
-- permission, report and token continues to key off the company id.
--
-- Uniqueness is enforced by the database so two companies can never claim one
-- address, including case-insensitively (DNS is case-insensitive).
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_domains (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  domain        text NOT NULL,
  is_primary    boolean NOT NULL DEFAULT true,
  -- Ownership is proven by a DNS TXT record before the address is trusted.
  verified_at   timestamz,
  verification_token text,
  created_by_platform_owner uuid REFERENCES platform_owners(id),
  created_at    timestamz NOT NULL DEFAULT now(),
  updated_at    timestamz NOT NULL DEFAULT now(),

  -- A registrable host: letters, digits, hyphens and dots. Punycode is allowed
  -- so an IDN company domain can be stored in its ASCII form.
  CONSTRAINT company_domains_format
    CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  -- No scheme, port, path or wildcard may be stored.
  CONSTRAINT company_domains_no_scheme CHECK (domain !~ '[:/]' AND domain !~ '\*'),
  CONSTRAINT company_domains_length CHECK (char_length(domain) BETWEEN 4 AND 253)
);

-- One address belongs to exactly one company, case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS company_domains_domain_key
  ON company_domains (lower(domain));

-- One primary domain per company (RULE 2.3.1 treats it as THE company address).
CREATE UNIQUE INDEX IF NOT EXISTS company_domains_primary_per_company
  ON company_domains (company_id)
  WHERE is_primary;

-- Fast lookup during address resolution, which runs before authentication.
CREATE INDEX IF NOT EXISTS company_domains_company_idx ON company_domains (company_id);

-- ---------------------------------------------------------------------------
-- Row-level security.
--
-- Address resolution happens BEFORE anyone is authenticated, so it runs through
-- the audited app.bypass_rls path (the same path that resolves companies.slug).
-- Every ordinary read still obeys tenant scoping, so a signed-in worker can only
-- ever see their own company's domain row.
-- ---------------------------------------------------------------------------
ALTER TABLE company_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_domains_tenant_read ON company_domains;
CREATE POLICY company_domains_tenant_read ON company_domains
  FOR SELECT
  USING (company_id = app.current_company_id());

DROP POLICY IF EXISTS company_domains_bypass_all ON company_domains;
CREATE POLICY company_domains_bypass_all ON company_domains
  FOR ALL
  USING (app.bypass_rls)
  WITH CHECK (app.bypass_rls);

COMMENT ON TABLE company_domains IS
  'Company-owned domains pointing at the same application (Vision RULE 2.3.1). Presentation only: companies.slug remains the tenant identity.';
COMMENT ON COLUMN company_domains.verified_at IS
  'NULL until DNS ownership is proven. An unverified domain must never resolve an address.';
