-- 0083_branch_and_disbursement_authority
--
-- RULE 7.2.2 - "Roles not on that list do not see the branch page at all ...
-- and their APIs are refused." The branch list, branch lifecycle and Branch
-- Workplace are refused at the route, so the authority has to exist as a
-- named verb rather than being inferred from a generic "view".
--
-- RULE 7.4.1 - "A branch is created only by a role with branch-creation
-- rights: the MD, HR, the GM or Assistant GM, the Operations Manager or
-- Assistant, and the Head Office Administrator. Branch Managers cannot create
-- branches." Creation and lifecycle therefore carry their own verb, which the
-- generic "create" (held by C.O., HR Officer, Finance and others for unrelated
-- work) must not satisfy - the same reasoning migration 0077 used for
-- allocate / register_customer / manage_workers.
--
-- RULE 19.13.1 / 10.4.3 - disbursement authority is the end of the configured
-- approval chain. The `disburse` verb already existed in the vocabulary but
-- was never granted to a single role, so it could never be expressed. It is
-- granted here to the approval-chain roles, and the disbursement route accepts
-- it alongside `create` so no existing chain loses its ability to disburse.

BEGIN;

INSERT INTO permission_verbs (verb)
VALUES ('view_branches'), ('create_branch')
ON CONFLICT (verb) DO NOTHING;

-- RULE 7.2.1 - who may see branches, drill into them and enter Branch
-- Workplaces. Kept in sync with BRANCH_WORKPLACE_ROLES in
-- src/modules/branch-workplace/routes.ts.
INSERT INTO platform_role_permission_bundles (role_key, verb)
SELECT r.role_key, 'view_branches'
  FROM (VALUES
    ('md'), ('deputy_md'), ('gm'), ('assistant_gm'),
    ('operations_manager'), ('assistant_operations_manager'),
    ('internal_auditor'), ('audit_officer'),
    ('compliance_officer'), ('risk_officer'),
    ('hr_manager'), ('hr_officer'),
    ('finance_manager'), ('accountant'), ('assistant_accountant'),
    ('cash_bank_reconciliation_officer'),
    ('credit_manager'), ('credit_officer'),
    ('head_office_administrator'), ('mis_reporting_officer'),
    ('it_system_administrator')
  ) AS r(role_key)
ON CONFLICT (role_key, verb) DO NOTHING;

-- RULE 7.4.1 - branch-creation rights (the narrow club). Branch Managers and
-- Assistant Operations Managers are deliberately absent.
INSERT INTO platform_role_permission_bundles (role_key, verb)
SELECT r.role_key, 'create_branch'
  FROM (VALUES
    ('md'), ('deputy_md'), ('gm'), ('assistant_gm'),
    ('operations_manager'), ('assistant_operations_manager'),
    ('hr_manager'), ('hr_officer'),
    ('head_office_administrator')
  ) AS r(role_key)
ON CONFLICT (role_key, verb) DO NOTHING;

-- Disbursement authority: the roles that sit in an approval chain (Vision
-- RULE 19.12.1/19.13.1). A company may narrow this per role afterwards; the
-- generic `create` verb remains accepted by the route, so narrowing never
-- strands a chain that is configured to disburse.
INSERT INTO platform_role_permission_bundles (role_key, verb)
SELECT r.role_key, 'disburse'
  FROM (VALUES
    ('md'), ('deputy_md'), ('gm'), ('assistant_gm'),
    ('operations_manager'), ('head_office_administrator'),
    ('branch_manager'), ('deputy_branch_manager'), ('area_manager'),
    ('credit_manager'), ('credit_officer'), ('finance_manager'),
    ('collection_officer'), ('senior_collection_officer')
  ) AS r(role_key)
ON CONFLICT (role_key, verb) DO NOTHING;

-- Existing companies: mirror the new bundle rows onto every company role that
-- already carries the key, so upgrading a live tenant never takes branch
-- visibility away from a role that legitimately had it (0049 pattern).
INSERT INTO role_permissions (role_id, verb)
SELECT r.id, g.verb
  FROM roles r
  JOIN (SELECT role_key, 'view_branches'::text AS verb
          FROM platform_role_permission_bundles WHERE verb = 'view_branches'
        UNION ALL
        SELECT role_key, 'create_branch'::text FROM platform_role_permission_bundles WHERE verb = 'create_branch'
        UNION ALL
        SELECT role_key, 'disburse'::text FROM platform_role_permission_bundles WHERE verb = 'disburse'
       ) AS g(role_key, verb) ON g.role_key = r.role_key
 WHERE NOT EXISTS (
         SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.verb = g.verb
       )
ON CONFLICT DO NOTHING;

COMMIT;
