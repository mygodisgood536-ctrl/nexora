-- 0016_role_permission_bundles.sql
-- Stage 6: Provision full role-specific permission bundles for all 32 built-in roles.
-- Per SRS v2.1 Part 1 §15-17 and Nexora_Role_Specifications_AZ_Complete.md,
-- each of the 32 built-in roles receives its own complete permission bundle.
-- This migration populates platform_role_permission_bundles which serves as
-- the default template when a company enables a built-in role.

-- Clear existing bundles (only md was provisioned in 0001)
DELETE FROM platform_role_permission_bundles;

-- ============================================================
-- EXECUTIVE CATEGORY (7 roles)
-- ============================================================

-- MD: Full platform access
INSERT INTO platform_role_permission_bundles (role_key, verb)
SELECT 'md', verb FROM permission_verbs;

-- Deputy MD: All except configure (branding/settings/role catalogue)
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('deputy_md', 'view'),
  ('deputy_md', 'create'),
  ('deputy_md', 'edit'),
  ('deputy_md', 'approve'),
  ('deputy_md', 'reject'),
  ('deputy_md', 'suspend'),
  ('deputy_md', 'assign'),
  ('deputy_md', 'export');

-- GM: Operational command - full company-wide view/approve/assign/suspend/create/export
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('gm', 'view'),
  ('gm', 'create'),
  ('gm', 'edit'),
  ('gm', 'approve'),
  ('gm', 'reject'),
  ('gm', 'suspend'),
  ('gm', 'assign'),
  ('gm', 'export');

-- Assistant GM: Same as GM but no create branch/worker, no terminate
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('assistant_gm', 'view'),
  ('assistant_gm', 'edit'),
  ('assistant_gm', 'approve'),
  ('assistant_gm', 'reject'),
  ('assistant_gm', 'assign'),
  ('assistant_gm', 'export');

-- Head Office Administrator: Admin functions (create workers/branches, roles, branding)
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('head_office_administrator', 'view'),
  ('head_office_administrator', 'create'),
  ('head_office_administrator', 'edit'),
  ('head_office_administrator', 'suspend'),
  ('head_office_administrator', 'assign'),
  ('head_office_administrator', 'configure'),
  ('head_office_administrator', 'export');

-- Operations Manager: Operational health, exceptions, staff coverage
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('operations_manager', 'view'),
  ('operations_manager', 'create'),
  ('operations_manager', 'edit'),
  ('operations_manager', 'assign'),
  ('operations_manager', 'export');

-- Assistant Operations Manager: Triage only, no escalate/execute
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('assistant_operations_manager', 'view'),
  ('assistant_operations_manager', 'edit'),
  ('assistant_operations_manager', 'export');

-- ============================================================
-- FINANCE CATEGORY (4 roles)
-- ============================================================

-- Finance Manager: Full financial control
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('finance_manager', 'view'),
  ('finance_manager', 'create'),
  ('finance_manager', 'edit'),
  ('finance_manager', 'approve'),
  ('finance_manager', 'export'),
  ('finance_manager', 'reverse'),
  ('finance_manager', 'configure');

-- Accountant: Bookkeeping - create/edit non-payment journal entries
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('accountant', 'view'),
  ('accountant', 'create'),
  ('accountant', 'edit'),
  ('accountant', 'export');

-- Assistant Accountant: Draft entries only (no direct post)
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('assistant_accountant', 'view'),
  ('assistant_accountant', 'create'),
  ('assistant_accountant', 'edit'),
  ('assistant_accountant', 'export');

-- Cash/Bank Reconciliation Officer: Reconciliation module only
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('cash_bank_reconciliation_officer', 'view'),
  ('cash_bank_reconciliation_officer', 'edit'),
  ('cash_bank_reconciliation_officer', 'approve'),
  ('cash_bank_reconciliation_officer', 'export');

-- ============================================================
-- HR/ADMIN CATEGORY (2 roles)
-- ============================================================

-- HR Manager: Full people management
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('hr_manager', 'view'),
  ('hr_manager', 'create'),
  ('hr_manager', 'edit'),
  ('hr_manager', 'suspend'),
  ('hr_manager', 'assign'),
  ('hr_manager', 'export');

-- HR Officer: No termination rights
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('hr_officer', 'view'),
  ('hr_officer', 'create'),
  ('hr_officer', 'edit'),
  ('hr_officer', 'assign'),
  ('hr_officer', 'export');

-- ============================================================
-- AUDIT/COMPLIANCE CATEGORY (4 roles)
-- ============================================================

-- Internal Auditor: Full read + operational performance visibility
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('internal_auditor', 'view'),
  ('internal_auditor', 'export');

-- Audit Officer: Narrower scope
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('audit_officer', 'view'),
  ('audit_officer', 'export');

-- Compliance Officer: Full read + compliance functions
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('compliance_officer', 'view'),
  ('compliance_officer', 'create'),
  ('compliance_officer', 'edit'),
  ('compliance_officer', 'export');

-- Risk Officer: Portfolio-risk focus
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('risk_officer', 'view'),
  ('risk_officer', 'export');

-- ============================================================
-- CREDIT/LOANS CATEGORY (3 roles)
-- ============================================================

-- Credit Manager: Full credit workflow
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('credit_manager', 'view'),
  ('credit_manager', 'create'),
  ('credit_manager', 'edit'),
  ('credit_manager', 'approve'),
  ('credit_manager', 'reject'),
  ('credit_manager', 'assign'),
  ('credit_manager', 'export');

-- Credit Officer: No final approval
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('credit_officer', 'view'),
  ('credit_officer', 'create'),
  ('credit_officer', 'edit'),
  ('credit_officer', 'assign'),
  ('credit_officer', 'export');

-- ============================================================
-- CUSTOMER/ACCOUNTS CATEGORY (2 roles)
-- ============================================================

-- Customer Service Officer: Full customer service
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('customer_service_officer', 'view'),
  ('customer_service_officer', 'create'),
  ('customer_service_officer', 'edit'),
  ('customer_service_officer', 'assign'),
  ('customer_service_officer', 'export');

-- Customer Service Manager: CSO + supervisory
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('customer_service_manager', 'view'),
  ('customer_service_manager', 'create'),
  ('customer_service_manager', 'edit'),
  ('customer_service_manager', 'assign'),
  ('customer_service_manager', 'suspend'),
  ('customer_service_manager', 'export');

-- ============================================================
-- OPERATIONS/FIELD CATEGORY (5 roles)
-- ============================================================

-- Area Manager: Regional oversight
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('area_manager', 'view'),
  ('area_manager', 'create'),
  ('area_manager', 'edit'),
  ('area_manager', 'assign'),
  ('area_manager', 'export');

-- Branch Manager: Full branch operations
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('branch_manager', 'view'),
  ('branch_manager', 'create'),
  ('branch_manager', 'edit'),
  ('branch_manager', 'approve'),
  ('branch_manager', 'reject'),
  ('branch_manager', 'assign'),
  ('branch_manager', 'suspend'),
  ('branch_manager', 'export');

-- Deputy/Assistant Branch Manager: BM variant
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('deputy_branch_manager', 'view'),
  ('deputy_branch_manager', 'create'),
  ('deputy_branch_manager', 'edit'),
  ('deputy_branch_manager', 'assign'),
  ('deputy_branch_manager', 'suspend'),
  ('deputy_branch_manager', 'export');

-- Collection Officer: Core collection operations
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('collection_officer', 'view'),
  ('collection_officer', 'create'),
  ('collection_officer', 'export');

-- Senior Collection Officer: CO + mentoring/escalation
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('senior_collection_officer', 'view'),
  ('senior_collection_officer', 'create'),
  ('senior_collection_officer', 'edit'),
  ('senior_collection_officer', 'assign'),
  ('senior_collection_officer', 'export');

-- ============================================================
-- OTHER CATEGORY (3 roles)
-- ============================================================

-- Recovery Officer: Overdue/legacy debt focus, elevated escalation
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('recovery_officer', 'view'),
  ('recovery_officer', 'create'),
  ('recovery_officer', 'edit'),
  ('recovery_officer', 'assign'),
  ('recovery_officer', 'export');

-- MIS/Reporting Officer: Read-only cross-branch reporting
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('mis_reporting_officer', 'view'),
  ('mis_reporting_officer', 'export');

-- IT/System Administrator: Technical admin
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('it_system_administrator', 'view'),
  ('it_system_administrator', 'create'),
  ('it_system_administrator', 'edit'),
  ('it_system_administrator', 'configure'),
  ('it_system_administrator', 'export');