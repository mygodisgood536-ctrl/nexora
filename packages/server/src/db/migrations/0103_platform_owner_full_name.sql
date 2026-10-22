-- 0103 - The Platform Owner's own display name.
--
-- RULE 3.1 - the Platform Owner's full name is "Cornelius Adedeji Victor" and
-- the owner console is where the owner's own account details live. The record
-- carried only the login email, so the console had no name to show and no
-- place to keep one.
--
-- The column is nullable and seeded with the owner's name from the Vision, so
-- an existing owner row gains the correct identity without a destructive
-- default of its own.

ALTER TABLE platform_owners
  ADD COLUMN IF NOT EXISTS full_name text;

UPDATE platform_owners
   SET full_name = 'Cornelius Adedeji Victor'
 WHERE full_name IS NULL;

-- A platform owner is a single, named, real person. The name is part of the
-- identity the Vision fixes, so it is required from here on.
ALTER TABLE platform_owners
  ALTER COLUMN full_name SET NOT NULL;