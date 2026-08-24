CREATE TABLE gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL
    CHECK (account_type IN ('asset','liability','equity','income','expense')),
  is_cash boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX idx_gl_accounts_company_type ON gl_accounts (company_id, account_type);

CREATE TRIGGER trg_gl_accounts_updated BEFORE UPDATE ON gl_accounts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  description text,
  source text NOT NULL
    CHECK (source IN ('payment_pipeline','reversal','system')),
  payment_id uuid REFERENCES payments(id),
  reversal_of_entry_id uuid REFERENCES journal_entries(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_entries_company_date ON journal_entries (company_id, entry_date);
CREATE INDEX idx_journal_entries_payment ON journal_entries (payment_id);

REVOKE UPDATE, DELETE ON journal_entries FROM nexora;

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id),
  gl_account_id uuid NOT NULL REFERENCES gl_accounts(id),
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  amount numeric NOT NULL CHECK (amount > 0)
);
CREATE INDEX idx_journal_lines_entry ON journal_lines (journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines (gl_account_id);

REVOKE UPDATE, DELETE ON journal_lines FROM nexora;

CREATE FUNCTION assert_journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  entry_balance numeric;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0)
    INTO entry_balance
    FROM journal_lines
    WHERE journal_entry_id = NEW.journal_entry_id;
  IF entry_balance <> 0 THEN
    RAISE EXCEPTION 'journal entry % is unbalanced (net %)', NEW.journal_entry_id, entry_balance;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_journal_entry_balanced
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  receipt_number text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, receipt_number)
);
CREATE INDEX idx_receipts_company_issued ON receipts (company_id, issued_at DESC);

REVOKE UPDATE, DELETE ON receipts FROM nexora;

CREATE TABLE reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_type text NOT NULL
    CHECK (item_type IN ('unallocated_payment','unmatched_payment','reversed_transaction','incomplete_processing')),
  payment_id uuid REFERENCES payments(id),
  provider text,
  provider_txn_ref text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved','dismissed')),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reconciliation_open ON reconciliation_items (company_id, status, created_at DESC);

CREATE TRIGGER trg_reconciliation_updated BEFORE UPDATE ON reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
