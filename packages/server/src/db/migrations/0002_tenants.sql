CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  code_prefix text NOT NULL UNIQUE CHECK (code_prefix ~ '^[A-Z]{3,6}$'),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  contact_email text,
  plan_tier text,
  status text NOT NULL DEFAULT 'in_setup'
    CHECK (status IN ('in_setup','pending_activation','active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_platform_owner uuid REFERENCES platform_owners(id),
  activated_at timestamptz,
  suspended_at timestamptz,
  last_activity_at timestamptz
);
CREATE INDEX idx_companies_status ON companies (status);

CREATE TABLE themes (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  primary_color text NOT NULL DEFAULT '#2547e0',
  secondary_color text NOT NULL DEFAULT '#ffffff',
  accent_color text NOT NULL DEFAULT '#f59e0b',
  navy_color text NOT NULL DEFAULT '#0b1f4b',
  logo_url text,
  login_background_url text,
  font_family text NOT NULL DEFAULT 'Poppins',
  extra_tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  allocation_priority text NOT NULL DEFAULT 'repayment_first'
    CHECK (allocation_priority IN ('repayment_first','savings_first')),
  partial_paid_counts boolean NOT NULL DEFAULT true,
  overdue_grace_days integer NOT NULL DEFAULT 0 CHECK (overdue_grace_days >= 0),
  temp_password_expiry_hours integer NOT NULL DEFAULT 72 CHECK (temp_password_expiry_hours > 0),
  customer_portal_enabled boolean NOT NULL DEFAULT false,
  branch_slug_regen_on_rename boolean NOT NULL DEFAULT false,
  notification_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  targets jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_enabled_roles (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_key text NOT NULL REFERENCES platform_role_catalogue(role_key),
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (company_id, role_key)
);

CREATE TABLE company_counters (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  counter_key text NOT NULL,
  next_value integer NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, counter_key)
);

CREATE TABLE platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  action text NOT NULL,
  company_id uuid REFERENCES companies(id),
  previous_value jsonb,
  new_value jsonb,
  reason text,
  session_ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_platform_audit_created ON platform_audit_logs (created_at DESC);
CREATE INDEX idx_platform_audit_company ON platform_audit_logs (company_id, created_at DESC);

REVOKE UPDATE, DELETE ON platform_audit_logs FROM nexora;
