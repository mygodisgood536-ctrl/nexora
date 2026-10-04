-- 0051_branch_in_setup_state
-- RULE 7.9.1 — a branch has FOUR states: In setup, Active, Suspended, Closed.
-- The schema only allowed three, so the Branch Workplace could never be opened
-- in its pre-opening state. Adding 'in_setup' widens the CHECK; existing rows
-- are unaffected because none can hold the new value yet.
--
-- RULE 7.9.2 — suspending a branch blocks branch-worker LOGINS (no deletion,
--   in-flight money untouched, reversible). That is enforced at login, not by
--   this constraint.
-- RULE 7.9.3 — closing blocks NEW customers, loans and workers, while existing
--   customers and loans keep being collected and reported. That is enforced at
--   the create paths.

BEGIN;

ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_status_check;
ALTER TABLE branches ADD CONSTRAINT branches_status_check
  CHECK (status IN ('in_setup','active','suspended','closed'));

COMMIT;
