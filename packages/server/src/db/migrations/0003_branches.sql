CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  address text NOT NULL,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','closed')),
  portal_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, slug),
  CONSTRAINT branch_code_format CHECK (code ~ '^[A-Z]{3,6}-[0-9]{3,}$')
);
CREATE INDEX idx_branches_company_status ON branches (company_id, status);

CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
