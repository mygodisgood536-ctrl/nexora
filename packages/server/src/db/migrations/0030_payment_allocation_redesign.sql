-- Stage 7D — Payment Allocation Redesign (Part 1 §21-24).
--
-- This migration implements the fundamental change to payment allocation:
--   * Removes automatic allocation from the pipeline
--   * Adds "pending_allocation" status for verified payments awaiting C.O. decision
--   * Adds payment_checkpoint table for tracking provider polling position
--   * Adds allocation fields to payments table for C.O. decisions
--   * Updates payment status enum with new states

-- ============================================================================
-- 1. Extend payment status enum with new states
-- ============================================================================
ALTER TABLE payments
  ALTER COLUMN status TYPE text
  USING status::text;

-- Drop the old CHECK constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;

-- Add new CHECK constraint with extended statuses
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN (
    'received',           -- webhook received, signature/idempotency checked
    'verified',           -- provider verification passed, customer/C.O. identified
    'pending_allocation', -- verified payment awaiting C.O. allocation decision
    'allocated',          -- C.O. has submitted exact allocation, awaiting posting
    'posted',             -- final financial posting completed
    'completed',          -- legacy: fully processed (auto-allocated)
    'duplicate_suppressed',
    'unmatched',          -- VA not found
    'unallocated',        -- customer found but no active loans / allocation failed
    'incomplete_processing',
    'reversed'
  ));

-- ============================================================================
-- 2. Add allocation fields to payments table for C.O. decisions
-- ============================================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS allocation_repayment_amount numeric DEFAULT 0 CHECK (allocation_repayment_amount >= 0),
  ADD COLUMN IF NOT EXISTS allocation_savings_amount numeric DEFAULT 0 CHECK (allocation_savings_amount >= 0),
  ADD COLUMN IF NOT EXISTS allocation_rollover_amount numeric DEFAULT 0 CHECK (allocation_rollover_amount >= 0),
  ADD COLUMN IF NOT EXISTS allocation_submitted_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS allocation_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS allocation_note text;

-- ============================================================================
-- 3. Add payment_checkpoint table for tracking provider polling position
-- ============================================================================
CREATE TABLE IF NOT EXISTS payment_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  provider text NOT NULL,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  last_provider_txn_ref text,
  last_provider_event_id text,
  last_value_date timestamptz,
  UNIQUE (company_id, provider, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_checkpoints_company
  ON payment_checkpoints (company_id, provider);

-- Grant permissions for payment_checkpoints
GRANT SELECT, INSERT, UPDATE ON payment_checkpoints TO nexora;
REVOKE DELETE ON payment_checkpoints FROM nexora;

-- Grant UPDATE permission on the newly added allocation columns.
-- ALTER COLUMN status TYPE text drops column-level grants on status, so
-- re-grant it here as well.
GRANT UPDATE (
  allocation_repayment_amount,
  allocation_savings_amount,
  allocation_rollover_amount,
  allocation_submitted_by,
  allocation_submitted_at,
  allocation_note
) ON payments TO nexora;
GRANT UPDATE (status) ON payments TO nexora;

-- ============================================================================
-- 4. RLS for payment_checkpoints
-- ============================================================================
ALTER TABLE payment_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_checkpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_company_scope ON payment_checkpoints;
CREATE POLICY rls_company_scope ON payment_checkpoints
  USING (company_id = app_current_company());

-- ============================================================================
-- 5. Add trigger for updated_at
-- ============================================================================
CREATE TRIGGER trg_payment_checkpoints_updated
  BEFORE UPDATE ON payment_checkpoints
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- 6. Add comment documentation
-- ============================================================================
COMMENT ON TABLE payment_checkpoints IS
'Tracks the latest successfully checked payment position per provider for safe incremental polling. Uses date/time + transaction identity to avoid skipping legitimate payments.';
COMMENT ON COLUMN payments.allocation_repayment_amount IS 'C.O.-decided loan repayment allocation (read-only after submission)';
COMMENT ON COLUMN payments.allocation_savings_amount IS 'C.O.-decided savings allocation (read-only after submission)';
COMMENT ON COLUMN payments.allocation_rollover_amount IS 'C.O.-decided rollover to next cycle (read-only after submission)';
COMMENT ON COLUMN payments.allocation_submitted_by IS 'C.O. user who submitted the allocation';
COMMENT ON COLUMN payments.allocation_submitted_at IS 'Timestamp when C.O. submitted the allocation';
COMMENT ON COLUMN payments.allocation_note IS 'Optional C.O. note for the allocation decision';

-- ============================================================================
-- 7. Update existing payment statuses to new values where applicable
-- ============================================================================
-- Payments with status 'completed' that were auto-allocated should remain 'completed'
-- Payments with status 'verified' should transition to 'pending_allocation'
-- This is a one-time migration; new payments will use the new flow
UPDATE payments
SET status = 'pending_allocation'
WHERE status = 'verified';

-- ============================================================================
-- 8. Add index for pending_allocation queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_payments_pending_allocation
  ON payments (company_id, status, branch_id)
  WHERE status = 'pending_allocation';

-- ============================================================================
-- 9. Add new notification kind for payment awaiting allocation
-- ============================================================================
-- The notifications table already supports arbitrary kind strings, so no schema change needed.
-- New kind: 'payment.awaiting_allocation'