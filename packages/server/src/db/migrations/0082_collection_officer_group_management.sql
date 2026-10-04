-- 0082_collection_officer_group_management
-- RULE 9.3.1: "Customers are organised into branch-level groups, created and
-- managed by Collection Officers (or a role with equivalent scope)."
-- Part 12.27 gives the Collection Officer "My Groups (his groups and their
-- members)" and the ability to "assign customers and groups".
--
-- DEFECT FIXED HERE: the collection_officer bundle granted only
-- view/create/export. Adding a customer to a group is gated on the "assign"
-- verb, so a Collection Officer could CREATE a group but could not put a
-- single member into it - the group the Vision says he manages could never be
-- populated by him.
--
-- The fix grants the precise "assign" verb rather than blanket "edit", so the
-- Collection Officer gains exactly what the Vision grants and nothing more:
-- no new ability to edit customers, loans, payments or settings.
--
-- RULE 5.5.1: a role is defined by its own powers; this widens the C.O.
-- bundle only by the single verb the Vision already assigns to him.

BEGIN;

INSERT INTO platform_role_permission_bundles (role_key, verb)
VALUES ('collection_officer', 'assign')
ON CONFLICT (role_key, verb) DO NOTHING;

-- Backfill every company that already has a Collection Officer role, so an
-- existing live company gains the same capability as a new one.
INSERT INTO role_permissions (role_id, verb)
SELECT r.id, 'assign'
  FROM roles r
 WHERE r.role_key = 'collection_officer'
ON CONFLICT (role_id, verb) DO NOTHING;

COMMIT;