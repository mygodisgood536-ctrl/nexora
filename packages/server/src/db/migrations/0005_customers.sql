CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_code text NOT NULL,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  phone text,
  email text,
  address text NOT NULL,
  kyc_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  kyc_complete boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'va_pending'
    CHECK (status IN ('va_pending','active','suspended','closed')),
  suspended_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, customer_code)
);
CREATE INDEX idx_customers_company_branch_status ON customers (company_id, branch_id, status);
CREATE INDEX idx_customers_company_status ON customers (company_id, status);

CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  description text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','closed')),
  closed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, branch_id, name)
);
CREATE INDEX idx_groups_company_branch_status ON groups (company_id, branch_id, status);

CREATE TRIGGER trg_groups_updated BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES users(id),
  PRIMARY KEY (group_id, customer_id)
);
CREATE INDEX idx_group_members_customer ON group_members (customer_id);
