import pg from "pg";

// One-off live delta applier (ledgered-migration caveat): 0013 must reach
// databases whose _migrations ledger already records earlier entries. The
// vitest globalSetup handles nexora_test automatically; this script covers
// nexora_dev. Run once: node scripts/apply-0013-dev.mjs
const targets = [
  "postgres://postgres:nexora-dev@localhost:5432/nexora_dev"
];

const sql = `
DROP POLICY IF EXISTS rls_tenant ON branches;
CREATE POLICY rls_tenant ON branches
  USING (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  )
  WITH CHECK (
    COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
    OR company_id = app_current_company()
  );
INSERT INTO _migrations (filename) VALUES ('0013_branch_rls_bypass.sql')
ON CONFLICT (filename) DO NOTHING;
`;

for (const connectionString of targets) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(`applied 0013 to ${connectionString}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`FAILED ${connectionString}:`, error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
