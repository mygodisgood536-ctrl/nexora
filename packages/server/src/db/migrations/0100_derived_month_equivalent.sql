-- 0100 - The monthly-equivalent duration is derived, never typed (RULE 19.3.8).
--
-- RULE 19.3.8: "Where a monthly-equivalent duration is displayed, the software
-- derives it from the configured repayment period; the C.O. does not manually
-- calculate or type a misleading month duration."
--
-- No month equivalent existed anywhere in the platform, so any screen that
-- wanted to show one would have had to have someone type it - precisely the
-- failure the rule forbids.
--
-- This is a PostgreSQL GENERATED ALWAYS column rather than a value computed in
-- application code, and that choice is the enforcement. A generated column
-- cannot be written by INSERT or UPDATE at all: no request body, no service
-- call, no direct SQL, and no future migration can put a different number here.
-- The duration is therefore not "computed correctly by convention", it is
-- unwritable by construction, which is the only way to guarantee a value no
-- person controls.
--
-- 30.4375 days is the mean Gregorian month (365.2425 / 12), used so a daily or
-- weekly cycle converts to months without the drift that 30 or 31 would cause.

ALTER TABLE loan_application_terms
  ADD COLUMN IF NOT EXISTS derived_month_equivalent numeric(10,2)
  GENERATED ALWAYS AS (
    CASE repayment_mode
      WHEN 'weekly' THEN round((repayment_periods * 7.0) / 30.4375, 2)
      WHEN 'daily'  THEN round(repayment_periods / 30.4375, 2)
      ELSE NULL
    END
  ) STORED;

-- RULE 19.3.6 / 19.3.7 - the tally is an exact-total check. The derived
-- duration must never become a second, looser path into the same numbers, so it
-- is recorded as derived from the configured period only and never accepted as
-- an input anywhere in the terms API.