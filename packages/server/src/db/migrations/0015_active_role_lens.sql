-- 0015_active_role_lens.sql
-- Stage 6: Add active_role_key to users for runtime role switching (Part 1 §16).
-- The active role lens is a UI preference — which of the user's active role
-- assignments they are currently "viewing as". It does NOT affect authorization
-- (which remains the union of all active assignments per Part 1 §16 merge rule).
-- It only controls which dashboard/layout the user sees.

ALTER TABLE users
  ADD COLUMN active_role_key text REFERENCES platform_role_catalogue(role_key);

-- Index for quick lookup of users by active role
CREATE INDEX idx_users_active_role ON users (company_id, active_role_key)
  WHERE active_role_key IS NOT NULL;