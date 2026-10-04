-- 0026_refresh_token_branch.sql
-- Stage 7 fix: store branch_id on refresh token so branch-scoped login
-- context is preserved across token rotation (Part 1 §9 / §13).
-- When a user logs in via a branch URL, the session's branch context
-- must survive access-token rotation; otherwise a refresh would drop
-- the branch and the user would lose their branch-scoped grants.

ALTER TABLE refresh_tokens ADD COLUMN branch_id uuid REFERENCES branches(id);

CREATE INDEX idx_refresh_tokens_branch ON refresh_tokens (branch_id) WHERE branch_id IS NOT NULL;

-- RLS policy already exists (0011) and uses bypass_rls for pre-auth.
-- No change needed: the column is just data.