-- RULE 6.3.1 / 6.4.3 / 5.8.1 - people operations are their own authority.
--
-- Creating and editing workers, ending assignments, and holding or
-- transferring a portfolio belong to the MD and HR (and the Branch Workplace
-- for its own branch workers). Naming the verb is what keeps HR out of the
-- customer book and the money, which is exactly the boundary RULE 6.4.3 draws:
-- HR can act on a worker and never on money, customer financial records,
-- allocations or accounting.
INSERT INTO permission_verbs (verb)
VALUES ('manage_workers')
ON CONFLICT (verb) DO NOTHING;

INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('md', 'manage_workers'),
  ('deputy_md', 'manage_workers'),
  ('hr_manager', 'manage_workers'),
  ('hr_officer', 'manage_workers'),
  -- RULE 6.3.1: "Creation rights follow the MD, then HR, then the Branch
  -- Workplace" - the Branch Manager creates workers for their own branch.
  ('branch_manager', 'manage_workers'),
  ('deputy_branch_manager', 'manage_workers')
ON CONFLICT (role_key, verb) DO NOTHING;
