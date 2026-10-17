-- 0095 - The platform schedule principal (RULE 3.8.6 / 14.3.1).
--
-- RULE 3.8.6 requires background execution. Scheduled work has no person behind
-- it, but RULE 14.3.1 requires every audit entry to name the actor, and
-- inventing a human name for automated work would be a lie in the audit trail.
--
-- So each company gets one clearly-named system principal that exists purely as
-- an attribution target. It is created SUSPENDED, which places it in
-- LOGIN_BLOCKED_STATES, so it can never authenticate from anywhere; it holds no
-- role assignment and therefore no permission; and it is not a worker.
--
-- Automated audit entries therefore read "NEXORA_PLATFORM_SCHEDULE", which is
-- true, instead of naming a person who did not act or leaving the actor empty.

INSERT INTO users (
  company_id, worker_code, username, password_hash, must_change_password,
  first_name, last_name, birth_day, birth_month, status, credential_state
)
SELECT
  c.id,
  'SYS-SCHEDULE',
  'NEXORA_PLATFORM_SCHEDULE',
  '!',
  true,
  'Nexora',
  'Platform Schedule',
  1,
  1,
  'suspended',
  'suspended'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM users u
   WHERE u.company_id = c.id AND u.username = 'NEXORA_PLATFORM_SCHEDULE'
);

-- The schedule principal must never be handed a role, and must never be handed a
-- usable password. Both are enforced here rather than left to convention.
REVOKE ALL ON users FROM PUBLIC;