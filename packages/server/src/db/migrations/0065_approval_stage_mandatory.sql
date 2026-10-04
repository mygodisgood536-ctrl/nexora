BEGIN;

ALTER TABLE approval_chain_steps
  ADD COLUMN IF NOT EXISTS mandatory boolean NOT NULL DEFAULT false;

COMMIT;
