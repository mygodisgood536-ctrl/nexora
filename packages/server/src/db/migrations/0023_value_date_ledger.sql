-- 0023_value_date_ledger.sql
-- Phase 1.5: the digital collection ledger (Part 2 §37) day-buckets actual
-- savings by the payment's VALUE DATE — the provider's transaction timestamp,
-- never Nexora's receipt time (Part 1 §21 "Delayed webhook": late-arriving
-- payments still land in the correct day's ledger). Savings movements receive
-- an explicit value-date column so day/week/month rollups are value-date-keyed
-- like the journal (entry_date) already is.
--
-- The loan side of the ledger is day-recoverable through the §25 FK chain
-- (payment_allocations → payments.value_date), so no schedule-row change is
-- needed; repayment_schedule_rows.paid_at remains the processing/settlement
-- marker, not a day-bucket key.
ALTER TABLE savings_transactions ADD COLUMN value_date date;
CREATE INDEX idx_savings_transactions_value_date
  ON savings_transactions (company_id, value_date);
COMMENT ON COLUMN savings_transactions.value_date IS
  'Value date (YYYY-MM-DD) of the transaction that produced this ledger row (Part 1 §21 delayed webhooks).';