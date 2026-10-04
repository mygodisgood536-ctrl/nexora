-- RULE 19.5.2 — a live face capture must pass the company's *configured*
-- quality controls. The thresholds are a company setting, not a constant in
-- the code, so a company can tighten them and every acceptance decision
-- records the thresholds that were actually applied.
CREATE TABLE company_face_quality_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  min_brightness numeric(4,3) NOT NULL DEFAULT 0.150
    CHECK (min_brightness > 0 AND min_brightness <= 1),
  min_clarity numeric(4,3) NOT NULL DEFAULT 0.300
    CHECK (min_clarity > 0 AND min_clarity <= 1),
  require_face_present boolean NOT NULL DEFAULT true,
  require_liveness boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_company_face_quality_settings_updated
  BEFORE UPDATE ON company_face_quality_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE company_face_quality_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_face_quality_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_tenant ON company_face_quality_settings
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

GRANT SELECT, INSERT, UPDATE ON company_face_quality_settings TO nexora;
REVOKE DELETE ON company_face_quality_settings FROM nexora;
