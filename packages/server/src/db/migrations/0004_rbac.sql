CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid REFERENCES branches(id),
  worker_code text NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  temp_password_expires_at timestamptz,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  phone text,
  passport_photo_url text,
  birth_day smallint NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
  birth_month smallint NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','active','suspended','terminated')),
  suspended_at timestamptz,
  terminated_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, worker_code),
  UNIQUE (company_id, username)
);
CREATE INDEX idx_users_company_branch ON users (company_id, branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX idx_users_company_status ON users (company_id, status);

ALTER TABLE branches
  ADD CONSTRAINT fk_branches_created_by FOREIGN KEY (created_by) REFERENCES users(id);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN
    ('executive','finance','hr_admin','audit_compliance','credit_loans','customer_accounts','operations_field','other')),
  is_system boolean NOT NULL DEFAULT false,
  source_template_key text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, role_key)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  verb text NOT NULL REFERENCES permission_verbs(verb),
  PRIMARY KEY (role_id, verb)
);

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  scope_type text NOT NULL CHECK (scope_type IN
    ('company_wide','head_office','multi_branch','single_branch','assigned_customers_groups_loans')),
  assignment_type text NOT NULL DEFAULT 'permanent'
    CHECK (assignment_type IN ('permanent','temporary')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  assigned_by uuid REFERENCES users(id),
  ended_at timestamptz,
  ended_by uuid REFERENCES users(id),
  end_reason text,
  replaced_by_assignment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT temporary_requires_dates CHECK (
    assignment_type = 'permanent' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)
  ),
  CONSTRAINT assignment_window CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX idx_role_assignments_user ON role_assignments (user_id, status);
CREATE INDEX idx_role_assignments_company ON role_assignments (company_id, status);
CREATE INDEX idx_role_assignments_expiry ON role_assignments (ends_at)
  WHERE assignment_type = 'temporary' AND status = 'active';

CREATE TABLE role_assignment_branches (
  assignment_id uuid NOT NULL REFERENCES role_assignments(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  PRIMARY KEY (assignment_id, branch_id)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id, revoked_at);

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
