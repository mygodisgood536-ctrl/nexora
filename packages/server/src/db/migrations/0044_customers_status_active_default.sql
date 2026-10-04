-- 0044_customers_status_active_default
-- Control Lock: "no VA at customer registration" — a customer registration
-- creates a profile only; no virtual account is issued at that point. The
-- legacy `va_pending` default (0005) came from the pre-v3.9 VA-at-registration
-- model and is no longer a real state. Nothing in the service layer ever
-- writes `va_pending` (customers.service inserts explicit `active`), so this
-- migration re-defaults the column and prunes the departed state from the
-- CHECK. Existing rows (none in test/dev flows, but defended anyway) are
-- normalised to `active`.

BEGIN;

UPDATE customers SET status = 'active' WHERE status = 'va_pending';

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_status_check;

ALTER TABLE customers
  ADD CONSTRAINT customers_status_check
  CHECK (status IN ('active', 'suspended', 'closed'));

ALTER TABLE customers
  ALTER COLUMN status SET DEFAULT 'active';

COMMIT;