BEGIN;

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS group_number text,
  ADD COLUMN IF NOT EXISTS group_address text,
  ADD COLUMN IF NOT EXISTS date_created date;

UPDATE groups
   SET group_number = 'LEGACY-' || replace(id::text, '-', ''),
       group_address = 'Legacy group address',
       date_created = created_at::date
 WHERE group_number IS NULL OR group_address IS NULL OR date_created IS NULL;

ALTER TABLE groups
  ALTER COLUMN group_number SET NOT NULL,
  ALTER COLUMN group_address SET NOT NULL,
  ALTER COLUMN date_created SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_groups_company_branch_number
  ON groups (company_id, branch_id, group_number);

ALTER TABLE group_members
  ADD COLUMN IF NOT EXISTS father_husband_name text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS group_role text NOT NULL DEFAULT 'member';

UPDATE group_members gm
   SET father_husband_name = COALESCE(NULLIF(gm.father_husband_name, ''), 'Legacy member'),
       marital_status = COALESCE(NULLIF(gm.marital_status, ''), 'single'),
       phone = COALESCE(NULLIF(gm.phone, ''), c.phone, ''),
       group_role = COALESCE(NULLIF(gm.group_role, ''), 'member')
  FROM customers c
 WHERE c.id = gm.customer_id;

ALTER TABLE group_members
  ALTER COLUMN father_husband_name SET NOT NULL,
  ALTER COLUMN marital_status SET NOT NULL,
  ALTER COLUMN phone SET NOT NULL;

ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_marital_status_check;
ALTER TABLE group_members ADD CONSTRAINT group_members_marital_status_check
  CHECK (marital_status IN ('single','married','divorced','widowed'));

ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_role_check;
ALTER TABLE group_members ADD CONSTRAINT group_members_role_check
  CHECK (group_role IN ('leader','secretary','treasurer','chief_whip','member'));

COMMIT;
