BEGIN;

-- RULE 19.1.4 — marital status and group role are selected from the company's
-- configured options. The hard-coded value lists from migration 0054 are
-- replaced by validation against the company's own configured option set, so a
-- company may define its own options and the database still refuses any value
-- the company did not configure.
UPDATE group_members SET marital_status = initcap(marital_status)
 WHERE marital_status IN ('single','married','divorced','widowed');
UPDATE group_members SET group_role = initcap(replace(group_role, '_', ' '))
 WHERE group_role IN ('leader','secretary','treasurer','chief_whip','member');

ALTER TABLE group_members
  ADD COLUMN IF NOT EXISTS company_options_company_id uuid;

UPDATE group_members gm
   SET company_options_company_id = gm.company_id
 WHERE gm.company_options_company_id IS NULL
   AND gm.company_id IS NOT NULL;

ALTER TABLE group_members
  ALTER COLUMN company_options_company_id SET NOT NULL;

ALTER TABLE group_members
  DROP CONSTRAINT IF EXISTS group_members_marital_status_check;

ALTER TABLE group_members
  DROP CONSTRAINT IF EXISTS group_members_role_check;

CREATE OR REPLACE FUNCTION group_members_require_configured_options()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_company_id uuid;
  v_marital_ok boolean;
  v_role_ok boolean;
BEGIN
  v_company_id := COALESCE(NEW.company_options_company_id, NEW.company_id);

  SELECT EXISTS (
    SELECT 1 FROM company_group_options o
     WHERE o.company_id = v_company_id
       AND o.option_kind = 'marital_status'
       AND o.option_value = NEW.marital_status
  ) INTO v_marital_ok;

  IF NOT v_marital_ok THEN
    RAISE EXCEPTION 'marital status "%" is not one of the company''s configured options',
      NEW.marital_status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM company_group_options o
     WHERE o.company_id = v_company_id
       AND o.option_kind = 'group_role'
       AND o.option_value = NEW.group_role
  ) INTO v_role_ok;

  IF NOT v_role_ok THEN
    RAISE EXCEPTION 'group role "%" is not one of the company''s configured options',
      NEW.group_role
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_group_members_configured_options
  BEFORE INSERT OR UPDATE OF marital_status, group_role, company_options_company_id
  ON group_members
  FOR EACH ROW EXECUTE FUNCTION group_members_require_configured_options();

CREATE INDEX IF NOT EXISTS idx_group_members_company_options
  ON group_members (company_options_company_id);

COMMIT;
