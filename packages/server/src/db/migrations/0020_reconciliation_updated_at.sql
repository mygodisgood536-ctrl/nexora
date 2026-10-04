-- Stage 7D — 0008_finance attached the touch_updated_at() BEFORE UPDATE
-- trigger to reconciliation_items but never declared the updated_at column
-- the trigger assigns. Any UPDATE of a reconciliation item (manual
-- allocation resolution) therefore fails at runtime with
-- 'record "new" has no field "updated_at"'. All other tables using
-- touch_updated_at() declare updated_at; add it here so the trigger's
-- intended semantics (last-mutation timestamp) work.
ALTER TABLE reconciliation_items
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();