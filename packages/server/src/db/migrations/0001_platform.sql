CREATE TABLE platform_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  totp_enabled boolean NOT NULL DEFAULT false,
  totp_secret_encrypted text,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE global_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO global_settings (key, value) VALUES
  ('default_theme', '{"primary":"#2547e0","primaryStrong":"#1d38b8","secondary":"#ffffff","navy":"#0b1f4b","accent":"#f59e0b","bg":"#f5f7fb","surface":"#ffffff","text":"#12224a","textMuted":"#5a687f","radiusCard":14,"fontFamily":"Poppins"}'),
  ('security_policy', '{"session_timeout_minutes":480,"device_trust_days":30,"po_lockout_threshold":5}'),
  ('notification_policy', '{"health_degraded":"in_app","health_outage":"in_app+email","storage_threshold_pct":85}'),
  ('data_retention', '{"platform_activity_years":7}');

CREATE TABLE permission_verbs (
  verb text PRIMARY KEY
);

INSERT INTO permission_verbs (verb) VALUES
  ('view'),('create'),('edit'),('approve'),('reject'),('suspend'),
  ('assign'),('disburse'),('export'),('delete'),('reverse'),('configure');

CREATE TABLE platform_role_catalogue (
  role_key text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN
    ('executive','finance','hr_admin','audit_compliance','credit_loans','customer_accounts','operations_field','other')),
  is_template boolean NOT NULL DEFAULT false,
  code_prefix text NOT NULL UNIQUE,
  available_platform_wide boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0
);

INSERT INTO platform_role_catalogue (role_key, name, category, is_template, code_prefix, display_order) VALUES
  ('md','MD','executive',false,'MD',1),
  ('deputy_md','Deputy MD','executive',false,'DM',2),
  ('gm','GM','executive',false,'GM',3),
  ('assistant_gm','Assistant GM','executive',false,'AG',4),
  ('head_office_administrator','Head Office Administrator','executive',false,'HA',5),
  ('operations_manager','Operations Manager','executive',false,'OM',6),
  ('assistant_operations_manager','Assistant Operations Manager','executive',false,'AO',7),
  ('finance_manager','Finance Manager','finance',false,'FM',8),
  ('accountant','Accountant','finance',false,'AC',9),
  ('assistant_accountant','Assistant Accountant','finance',false,'AA',10),
  ('cash_bank_reconciliation_officer','Cash/Bank Reconciliation Officer','finance',false,'RC',11),
  ('hr_manager','HR Manager','hr_admin',false,'HR',12),
  ('hr_officer','HR Officer','hr_admin',false,'HO',13),
  ('internal_auditor','Internal Auditor','audit_compliance',false,'IA',14),
  ('audit_officer','Audit Officer','audit_compliance',false,'AU',15),
  ('compliance_officer','Compliance Officer','audit_compliance',false,'CO',16),
  ('risk_officer','Risk Officer','audit_compliance',false,'RO',17),
  ('credit_manager','Credit Manager','credit_loans',false,'CM',18),
  ('credit_officer','Credit Officer','credit_loans',false,'CR',19),
  ('loan_officer','Loan Officer','credit_loans',false,'LO',20),
  ('account_officer','Account Officer','customer_accounts',false,'NT',21),
  ('field_account_officer','Field Account Officer','customer_accounts',false,'FA',22),
  ('customer_service_officer','Customer Service Officer','customer_accounts',false,'CS',23),
  ('customer_service_manager','Customer Service Manager','customer_accounts',false,'CQ',24),
  ('area_manager','Area Manager','operations_field',false,'AM',25),
  ('branch_manager','Branch Manager','operations_field',false,'BM',26),
  ('deputy_branch_manager','Deputy/Assistant Branch Manager','operations_field',false,'DB',27),
  ('collection_officer','Collection Officer','operations_field',false,'CI',28),
  ('senior_collection_officer','Senior Collection Officer','operations_field',false,'SC',29),
  ('recovery_officer','Recovery Officer','other',false,'RV',30),
  ('mis_reporting_officer','MIS/Reporting Officer','other',false,'MI',31),
  ('it_system_administrator','IT/System Administrator','other',false,'IT',32),
  ('template_finance_officer','Finance Officer','finance',true,'FO',100),
  ('template_hr_assistant','HR Assistant','hr_admin',true,'H2',101),
  ('template_administrative_officer','Administrative Officer','hr_admin',true,'AD',102),
  ('template_loan_processing_officer','Loan Processing Officer','credit_loans',true,'LP',103),
  ('template_credit_analyst','Credit Analyst','credit_loans',true,'CA',104),
  ('template_assistant_account_officer','Assistant Account Officer','customer_accounts',true,'N2',105),
  ('template_field_officer','Field Officer','operations_field',true,'FL',106),
  ('template_operations_officer','Operations Officer','operations_field',true,'OP',107),
  ('template_portfolio_manager','Portfolio Manager','other',true,'PM',108),
  ('template_treasury_officer','Treasury Officer','other',true,'TR',109),
  ('template_data_reporting_analyst','Data/Reporting Analyst','other',true,'DR',110);

CREATE TABLE platform_role_permission_bundles (
  role_key text NOT NULL REFERENCES platform_role_catalogue(role_key),
  verb text NOT NULL REFERENCES permission_verbs(verb),
  PRIMARY KEY (role_key, verb)
);

INSERT INTO platform_role_permission_bundles (role_key, verb)
SELECT 'md', verb FROM permission_verbs;

CREATE TABLE platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','expired')),
  starts_at timestamptz,
  ends_at timestamptz,
  target_scope text NOT NULL DEFAULT 'platform' CHECK (target_scope IN ('platform','company')),
  target_company_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE support_access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  reason text NOT NULL,
  requested_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz
);

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text,
  signature_valid boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','accepted','rejected_signature','rejected_malformed','duplicate_suppressed','forwarded'))
);
CREATE INDEX idx_webhook_events_received ON webhook_events (received_at DESC);
CREATE UNIQUE INDEX uq_webhook_provider_event ON webhook_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

REVOKE UPDATE, DELETE ON webhook_events FROM nexora;
