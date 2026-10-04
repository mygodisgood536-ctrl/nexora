BEGIN;

-- RULE 19.1.4 — group role and marital status are selected from the company's
-- configured options, never free-typed. The default option sets below are the
-- values Part 19.1.4 names; a company may change its own set afterwards.
INSERT INTO company_group_options (company_id, option_kind, option_value, sort_order)
SELECT c.id, 'group_role', v.option_value, v.sort_order
FROM companies c
CROSS JOIN (VALUES
  ('Leader', 1), ('Secretary', 2), ('Treasurer', 3), ('Chief Whip', 4), ('Member', 5)
) AS v(option_value, sort_order)
ON CONFLICT (company_id, option_kind, option_value) DO NOTHING;

INSERT INTO company_group_options (company_id, option_kind, option_value, sort_order)
SELECT c.id, 'marital_status', v.option_value, v.sort_order
FROM companies c
CROSS JOIN (VALUES
  ('Single', 1), ('Married', 2), ('Divorced', 3), ('Widowed', 4)
) AS v(option_value, sort_order)
ON CONFLICT (company_id, option_kind, option_value) DO NOTHING;

COMMIT;
