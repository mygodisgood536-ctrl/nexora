-- 0092 - The loan application is a resumable state machine with a real draft
-- state (RULE 19.6.1 / 19.11.2).
--
-- RULE 19.11.2: "The C.O. submits only after required stages and validations
-- pass. Submission changes the application into the configured approval
-- workflow." RULE 19.6.1: "A loan application is a persistent state machine.
-- Leaving the application never deletes the application or silently resets its
-- stage."
--
-- Previously an application was INSERTed directly into `in_review` at the first
-- approval stage, which meant an approval workflow began the moment a draft row
-- was created: no submission gate existed, `readyForSubmission` was computed and
-- then never consulted by any decision path, and approvers were notified about an
-- application that had not been submitted.
--
-- This adds an explicit `draft` state and the submission timestamp, so draft and
-- submitted are distinguishable facts rather than the same row.

ALTER TABLE loan_applications
  DROP CONSTRAINT IF EXISTS loan_applications_status_check;

-- RULE 19.12.8 - "Return for Information" is a separate auditable state and is
-- never disguised as rejection (migration 0069), so it is preserved here.
ALTER TABLE loan_applications
  ADD CONSTRAINT loan_applications_status_check
  CHECK (status IN (
    'draft','submitted','in_review','information_requested',
    'approved','rejected','disbursed','withdrawn'
  ));

ALTER TABLE loan_applications
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- RULE 19.6.1 / 19.6.4 - the last successfully saved stage is what the
-- application resumes at, so it is stored on the application itself rather than
-- being inferred from whichever stage rows happen to exist.
ALTER TABLE loan_applications
  ADD COLUMN IF NOT EXISTS last_saved_stage_key text;

-- Every application already in the database was created under the old rule and
-- is genuinely in (or past) the approval workflow, so it is `submitted` and its
-- submission time is its creation time. Nothing is silently reclassified.
UPDATE loan_applications
   SET status = 'submitted',
       submitted_at = created_at
 WHERE status IN ('submitted','in_review')
   AND submitted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_applications_draft
  ON loan_applications (company_id, status)
  WHERE status = 'draft';