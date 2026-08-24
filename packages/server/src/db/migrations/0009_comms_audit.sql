CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  actor_user_id uuid REFERENCES users(id),
  role_used text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  payment_id uuid REFERENCES payments(id),
  transaction_ref text,
  ip_address text,
  user_agent text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_company_created ON audit_logs (company_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs (company_id, entity_type, entity_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_user_id, created_at DESC);

REVOKE UPDATE, DELETE ON audit_logs FROM nexora;

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES users(id),
  recipient_customer_id uuid REFERENCES customers(id),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel text NOT NULL DEFAULT 'in_app'
    CHECK (channel IN ('in_app','email','in_app+email')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_recipient CHECK (
    (recipient_user_id IS NOT NULL) <> (recipient_customer_id IS NOT NULL)
  )
);
CREATE INDEX idx_notifications_user ON notifications (recipient_user_id, read_at, created_at DESC);
CREATE INDEX idx_notifications_customer ON notifications (recipient_customer_id, read_at, created_at DESC);
