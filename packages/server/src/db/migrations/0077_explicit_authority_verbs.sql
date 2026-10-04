-- RULE 6.6.1 / 6.4.3 - "Finance cannot enter or edit ... customer financial
-- records" and "HR ... can never act on money, customer financial records".
--
-- The generic "create" verb is too coarse to express that boundary, because
-- Finance legitimately holds "create" in order to prepare a correction
-- request. The two authorities that must never be reachable through a generic
-- CRUD verb are therefore named explicitly:
--
--   allocate         - post an allocation against an already-verified payment
--   register_customer- put a new customer on the book
--
-- They are granted only to the roles the vision grants the power, so a role
-- that lacks the power cannot reach the surface with a verb it happens to hold
-- for an unrelated purpose.
INSERT INTO permission_verbs (verb)
VALUES ('allocate'), ('register_customer'), ('manage_workers')
ON CONFLICT (verb) DO NOTHING;

-- RULE 6.6.1 - allocation belongs to the C.O. (and the GM/MD covering the
-- book). Finance and HR never receive it.
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('collection_officer', 'allocate'),
  ('senior_collection_officer', 'allocate'),
  ('gm', 'allocate'),
  ('md', 'allocate')
ON CONFLICT (role_key, verb) DO NOTHING;

-- RULE 19.1 / 6.3 - the C.O. registers the customer; Head Office covers it.
-- Finance reads the book but never writes to it, and HR reads it (RULE 6.4.1)
-- without ever entering a customer record.
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('collection_officer', 'register_customer'),
  ('senior_collection_officer', 'register_customer'),
  ('deputy_md', 'register_customer'),
  ('gm', 'register_customer'),
  ('md', 'register_customer')
ON CONFLICT (role_key, verb) DO NOTHING;

-- RULE 6.3.1 / 6.4.3 / 5.8.1 - people operations are their own authority:
-- creating and editing workers, ending assignments and holding or transferring
-- a portfolio belong to the MD and HR (and the Branch Workplace for its own
-- branch workers). Naming the verb is what keeps HR out of the customer book
-- and the money, which is exactly the boundary RULE 6.4.3 draws.
INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES
  ('md', 'manage_workers'),
  ('deputy_md', 'manage_workers'),
  ('hr_manager', 'manage_workers'),
  ('hr_officer', 'manage_workers')
ON CONFLICT (role_key, verb) DO NOTHING;
