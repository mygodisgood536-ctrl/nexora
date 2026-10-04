-- Fix pipeline_jobs status check constraint to allow new statuses
-- This migration updates the pipeline_jobs table to support the new
-- payment allocation flow statuses.

ALTER TABLE pipeline_jobs DROP CONSTRAINT IF EXISTS pipeline_jobs_status_check;

ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_status_check
  CHECK (status IN (
    'pending','running','succeeded','failed','retrying',
    'pending_allocation','allocated'
  ));