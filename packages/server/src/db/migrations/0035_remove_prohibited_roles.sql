-- Vision prohibition: Loan Officer, Account Officer, Field Account Officer and
-- the Field Officer template roles are prohibited. Remove them everywhere.

BEGIN;

DELETE FROM platform_role_permission_bundles
WHERE role_key IN
  ('loan_officer','account_officer','field_account_officer',
   'template_assistant_account_officer','template_field_officer');

DELETE FROM company_enabled_roles
WHERE role_key IN
  ('loan_officer','account_officer','field_account_officer',
   'template_assistant_account_officer','template_field_officer');

DELETE FROM role_assignments
WHERE role_id IN (SELECT id FROM roles WHERE role_key IN
  ('loan_officer','account_officer','field_account_officer',
   'template_assistant_account_officer','template_field_officer'));

DELETE FROM roles
WHERE role_key IN
  ('loan_officer','account_officer','field_account_officer',
   'template_assistant_account_officer','template_field_officer');

UPDATE users SET active_role_key = NULL
WHERE active_role_key IN
  ('loan_officer','account_officer','field_account_officer',
   'template_assistant_account_officer','template_field_officer');

DELETE FROM platform_role_catalogue
WHERE role_key IN
  ('loan_officer','account_officer','field_account_officer',
   'template_assistant_account_officer','template_field_officer');

COMMIT;