-- 0053_customer_profile_completeness
-- RULE 9.2.2 — "Registration captures a complete profile. The following must
-- all be captured, and the profile must be complete before a loan can be
-- disbursed."
--
-- The `customers` table only carried name, phone, email, address and a generic
-- KYC blob, so nearly every required group was absent:
--
--   Identity  : gender, date of birth, marital status, mother's maiden name
--   Contact   : alternative phone
--   Address   : business/work address, location pin (lat/lng)
--   ID        : identification type and number
--   Provider  : BVN or NIN (the branch's provider may require it for the VA)
--   Business  : occupation, business type, estimated income
--   NOK       : next-of-kin name, relationship, phone  (required)
--   Guarantor : guarantor name, relationship, phone, address
--
-- `profile_complete` is NOT NULL DEFAULT false so the completeness gate can
-- fail closed: disbursement checks it and refuses an incomplete profile.

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS gender text
    CHECK (gender IS NULL OR gender IN ('male','female')),
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS marital_status text
    CHECK (marital_status IS NULL OR marital_status IN
      ('single','married','divorced','widowed')),
  ADD COLUMN IF NOT EXISTS mothers_maiden_name text,
  ADD COLUMN IF NOT EXISTS alternative_phone text,
  ADD COLUMN IF NOT EXISTS business_address text,
  ADD COLUMN IF NOT EXISTS location_lat numeric(10,7),
  ADD COLUMN IF NOT EXISTS location_lng numeric(10,7),
  ADD COLUMN IF NOT EXISTS identification_type text,
  ADD COLUMN IF NOT EXISTS identification_number text,
  ADD COLUMN IF NOT EXISTS bvn text,
  ADD COLUMN IF NOT EXISTS nin text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS estimated_income numeric(14,2),
  ADD COLUMN IF NOT EXISTS next_of_kin_name text,
  ADD COLUMN IF NOT EXISTS next_of_kin_relationship text,
  ADD COLUMN IF NOT EXISTS next_of_kin_phone text,
  ADD COLUMN IF NOT EXISTS guarantor_name text,
  ADD COLUMN IF NOT EXISTS guarantor_relationship text,
  ADD COLUMN IF NOT EXISTS guarantor_phone text,
  ADD COLUMN IF NOT EXISTS guarantor_address text,
  ADD COLUMN IF NOT EXISTS profile_complete boolean NOT NULL DEFAULT false;

-- The location pin is either wholly present or wholly absent.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_location_pin_pair;
ALTER TABLE customers ADD CONSTRAINT customers_location_pin_pair
  CHECK ((location_lat IS NULL AND location_lng IS NULL)
      OR (location_lat IS NOT NULL AND location_lng IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_customers_profile_complete
  ON customers (company_id, profile_complete);

COMMENT ON COLUMN customers.profile_complete IS
  'RULE 9.2.2 — set only when every required profile group is captured. '
  'Loan disbursement refuses an incomplete profile.';

COMMIT;
