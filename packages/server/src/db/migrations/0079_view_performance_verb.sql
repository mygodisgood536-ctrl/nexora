-- RULE 12.0.2 / 11.x - performance tables and financial statements are their own
-- capability. The plain "view" verb cannot express it, because a Collection
-- Officer must be able to read the customer book, the group book and the
-- pending allocation queue while having no company performance view at all.
--
-- view_performance therefore names exactly the surfaces a C.O. never has:
-- the company/branch/staff performance tables and the accounting statements.
INSERT INTO permission_verbs (verb)
VALUES ('view_performance')
ON CONFLICT (verb) DO NOTHING;

INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('md', 'view_performance'),
  ('deputy_md', 'view_performance'),
  ('gm', 'view_performance'),
  ('finance_manager', 'view_performance'),
  ('accountant', 'view_performance'),
  ('assistant_accountant', 'view_performance'),
  ('cash_bank_reconciliation_officer', 'view_performance'),
  ('internal_auditor', 'view_performance'),
  ('audit_officer', 'view_performance'),
  ('branch_manager', 'view_performance'),
  ('deputy_branch_manager', 'view_performance'),
  ('area_manager', 'view_performance'),
  ('mis_reporting_officer', 'view_performance'),
  ('credit_manager', 'view_performance'),
  ('recovery_officer', 'view_performance')
ON CONFLICT (role_key, verb) DO NOTHING;
