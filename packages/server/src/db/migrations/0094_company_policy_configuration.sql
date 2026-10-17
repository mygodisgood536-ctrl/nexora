-- 0094 - Company-configurable policy values (RULE 18.11 / 18.13 / 18.14).
--
-- RULE 18.11 - "What are the default overdue thresholds? A grace period, then
-- overdue buckets at 30, 60 and 90 days, all configurable per company. The
-- values are defaults, not law." The escalation ladder read 30/60 as code
-- constants, so a company could not configure them.
--
-- RULE 18.13 - "Whose timezone applies? The company's configured timezone for all
-- company-side dates and cut-offs; the platform's timezone for platform records."
-- Several company-side computations used the database's `current_date`, which is
-- UTC, so a Lagos company saw the wrong "today" for part of every night.
--
-- RULE 18.14 - plans and tiers are optional and "can cap branch counts and
-- features; if not used, they stay switched off". The column existed and nothing
-- read it.

-- The bucketed day thresholds a company sees on its portfolio-at-risk view.
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS overdue_bucket_1_days integer NOT NULL DEFAULT 30
    CHECK (overdue_bucket_1_days > 0),
  ADD COLUMN IF NOT EXISTS overdue_bucket_2_days integer NOT NULL DEFAULT 60
    CHECK (overdue_bucket_2_days > overdue_bucket_1_days),
  ADD COLUMN IF NOT EXISTS overdue_bucket_3_days integer NOT NULL DEFAULT 90
    CHECK (overdue_bucket_3_days > overdue_bucket_2_days),
  ADD COLUMN IF NOT EXISTS collection_rate_threshold_pct numeric(5,2)
    CHECK (collection_rate_threshold_pct IS NULL OR collection_rate_threshold_pct > 0);

-- The escalation ladder thresholds, per company. A NULL row means "use the
-- documented defaults", so an unconfigured company behaves exactly as before.
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS escalation_level_2_days integer
    CHECK (escalation_level_2_days IS NULL OR escalation_level_2_days >= 0),
  ADD COLUMN IF NOT EXISTS escalation_level_3_days integer
    CHECK (escalation_level_3_days IS NULL OR escalation_level_3_days >= 0),
  ADD COLUMN IF NOT EXISTS escalation_level_4_days integer
    CHECK (escalation_level_4_days IS NULL OR escalation_level_4_days >= 0),
  ADD COLUMN IF NOT EXISTS escalation_level_5_days integer
    CHECK (escalation_level_5_days IS NULL OR escalation_level_5_days >= 0);

-- RULE 18.14 - a plan may cap branches and enable feature groups.
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS plan_max_branches integer
    CHECK (plan_max_branches IS NULL OR plan_max_branches > 0),
  ADD COLUMN IF NOT EXISTS plan_features jsonb NOT NULL DEFAULT '{}'::jsonb;

-- RULE 19.9.3 - the bank-account-name and government-ID name match rule is
-- "according to the configured matching rule". It was a hard-coded three-way
-- string equality, so the company could not configure it.
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS name_match_rule text NOT NULL DEFAULT 'exact_normalised'
    CHECK (name_match_rule IN ('exact_normalised','surname_and_first_initial')),
  ADD COLUMN IF NOT EXISTS liveness_provider text;

-- RULE 18.13 - "the company's configured timezone for all company-side dates and
-- cut-offs". Company-side computations used PostgreSQL's `current_date`, which
-- is UTC, so a Lagos company saw the wrong "today" for part of every night and
-- overdue ages drifted by a day around midnight.
--
-- This resolves "today" from the tenant transaction's company and its configured
-- timezone, so every company-side date cut-off uses one rule. A company with no
-- timezone configured falls back to UTC, which is what the database was already
-- doing, so nothing changes until a company configures one.
CREATE FUNCTION app_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT s.timezone FROM company_settings s WHERE s.company_id = app_current_company()),
    'UTC'
  ))::date
$$;