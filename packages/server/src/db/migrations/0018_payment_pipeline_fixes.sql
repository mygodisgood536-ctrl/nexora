-- Stage 7D — Part 1 Section 21: payment pipeline schema fixes.
--
-- 1) payments.branch_id / payments.customer_id were declared NOT NULL in
--    0007_payments. The pipeline records "unmatched" payments (webhook
--    received, virtual account could not be resolved) as payments rows too
--    (the unmatched_payments queue references payments(id)); such rows have
--    no branch or customer. The queue tables created in 0017 already model
--    branch_id/customer_id as nullable, so relax the base table to match.
ALTER TABLE payments ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE payments ALTER COLUMN customer_id DROP NOT NULL;