-- Stage 3: platform-owner sessions share the refresh-token store but are not
-- tenant-scoped, so company_id becomes nullable and the owning principal is
-- recorded explicitly (exactly one of the two columns per row).
ALTER TABLE refresh_tokens ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE refresh_tokens ADD COLUMN platform_owner_id uuid REFERENCES platform_owners(id);
ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_token_principal_check
  CHECK ((company_id IS NOT NULL) <> (platform_owner_id IS NOT NULL));
CREATE INDEX idx_refresh_tokens_platform ON refresh_tokens (platform_owner_id, revoked_at);
