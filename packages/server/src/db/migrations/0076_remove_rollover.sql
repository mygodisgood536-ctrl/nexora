-- RULE 10.8.1 / 3.1 - "no rollover/roll-forward, no residual" is a
-- prohibition, not a configuration. The columns that used to carry a
-- C.O.-decided rollover are removed so the concept cannot be stored, read or
-- presented anywhere in the product. The allocation rule stays exact:
-- Loan Repayment + Savings = Verified Payment, with nothing left over and
-- nothing carried forward.
DO $$
DECLARE
  nonzero integer;
BEGIN
  SELECT count(*) INTO nonzero FROM payment_allocations WHERE rollover_amount <> 0;
  IF nonzero > 0 THEN
    RAISE EXCEPTION
      'RULE 10.8.1: % payment allocation(s) carry a non-zero rollover; resolve them manually before this migration can remove rollover',
      nonzero;
  END IF;
  SELECT count(*) INTO nonzero FROM payments WHERE allocation_rollover_amount <> 0;
  IF nonzero > 0 THEN
    RAISE EXCEPTION
      'RULE 10.8.1: % payment(s) carry a non-zero allocation rollover; resolve them manually before this migration can remove rollover',
      nonzero;
  END IF;
END $$;

ALTER TABLE payment_allocations DROP COLUMN IF EXISTS rollover_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS allocation_rollover_amount;
