/**
 * ISS-008 FUNCTIONAL PROOF (hardened).
 *
 * Runs the REAL `resetDatabase()` + `runMigrations()` against a throwaway
 * SCRATCH database. The journey database is never used or modified.
 *
 * Hardening (earlier attempts hung because killed processes left PostgreSQL
 * backends attached to the scratch database):
 *  - unique scratch database name per attempt, so a stale one cannot block;
 *  - only backends attached to THIS scratch database are terminated;
 *  - cleanup runs on success, failure and interruption;
 *  - a watchdog force-exits instead of hanging forever;
 *  - every step is timestamped, so a hang is attributable to a step.
 *
 * Exit code 0 ONLY if every assertion passed.
 */
process.env.NODE_ENV = "test";

import pg from "pg";
import { resetDatabase, runMigrations, adminUrlFor } from "../src/db/migrate";

const ADMIN =
  process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/postgres";
const APP_ROLE = process.env.APP_DATABASE_ROLE ?? "nexora";
const WATCHDOG_MS = Number(process.env.PROOF_WATCHDOG_MS ?? 900_000);

// Unique per attempt: guarantees we never collide with an abandoned database.
const SCRATCH_DB = `nexora_scratch_iss008_${process.pid}_${Date.now().toString(36)}`;
const SCRATCH_URL = ADMIN.replace(/\/[^/]*$/, `/${SCRATCH_DB}`);
const APP_URL = `postgres://${APP_ROLE}:nexora@localhost:5432/${SCRATCH_DB}`;

const PROTECTED = ["nexora_test", "nexora_dev", "nexora_unittest", "postgres", "template1"];

const results: { name: string; ok: boolean; detail: string }[] = [];
const started = Date.now();
function stamp(step: string): void {
  // eslint-disable-next-line no-console -- proof progress
  console.log(`[+${((Date.now() - started) / 1000).toFixed(1)}s] ${step}`);
}
function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  // eslint-disable-next-line no-console -- proof output
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` :: ${detail}` : ""}`);
}

/** Terminate ONLY backends attached to the scratch database, then drop it. */
async function destroyScratch(): Promise<void> {
  let admin: pg.Client;
  try {
    admin = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 10_000 });
    await admin.connect();
  } catch {
    return;
  }
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [SCRATCH_DB]
    );
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    // eslint-disable-next-line no-console -- proof output
    console.log(`[cleanup] dropped ${SCRATCH_DB}`);
  } catch (e) {
    // eslint-disable-next-line no-console -- proof output
    console.log(`[cleanup] ${SCRATCH_DB}: ${(e as Error).message.slice(0, 90)}`);
  } finally {
    await admin.end().catch(() => {});
  }
}

const watchdog = setTimeout(() => {
  // eslint-disable-next-line no-console -- proof output
  console.log(`\nWATCHDOG: exceeded ${WATCHDOG_MS}ms - aborting as FAILURE`);
  void destroyScratch().finally(() => process.exit(2));
}, WATCHDOG_MS);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    // eslint-disable-next-line no-console -- proof output
    console.log(`\n${sig} received - cleaning up scratch database`);
    void destroyScratch().finally(() => process.exit(3));
  });
}

/** Proves the security contexts using the APPLICATION's own helpers. */
async function proveContexts(): Promise<void> {
  // (a) raw access with no security context -> RLS must hide tenant data.
  stamp("proveContexts: raw access (no context)");
  const raw = new pg.Client({ connectionString: APP_URL });
  await raw.connect();
  const rows = await raw.query<{ n: number }>("SELECT count(*)::int n FROM companies");
  check(
    "no security context: tenant data is not exposed (RLS)",
    rows.rows[0].n === 0,
    `raw SELECT companies -> ${rows.rows[0].n} rows`
  );
  let denied = false;
  let denyMsg = "";
  try {
    await raw.query(
      "INSERT INTO companies (name, code_prefix, slug, status) VALUES ('ctx','CTX','ctx','active')"
    );
  } catch (e) {
    denied = true;
    denyMsg = (e as Error).message.slice(0, 80);
  }
  check("no security context: unauthorized write is refused (fails closed)", denied, denyMsg);
  await raw.end();

  // (b)(c) use the REAL application helpers, not raw SQL.
  // The pool reads env.DATABASE_URL at import time, so it must be set first.
  stamp("proveContexts: importing application helpers (pool -> scratch DB)");
  process.env.DATABASE_URL = APP_URL;
  const repo = await import("../src/db/repo");
  const { closePool } = await import("../src/db/pool");

  // (b) platform/pre-auth bypass: the Vision permits company creation here.
  stamp("proveContexts: withBypass -> create company A and B");
  const [a, b] = await repo.withBypass(async (c) => {
    const one = await c.query(
      "INSERT INTO companies (name, code_prefix, slug, status) VALUES ('Bypass A','BPA','bypass-a','active') RETURNING id"
    );
    const two = await c.query(
      "INSERT INTO companies (name, code_prefix, slug, status) VALUES ('Bypass B','BPB','bypass-b','active') RETURNING id"
    );
    return [one.rows[0].id as string, two.rows[0].id as string];
  });
  check("withBypass: platform path CAN create companies", !!a && !!b, `A=${a?.slice(0, 8)} B=${b?.slice(0, 8)}`);

  // (c) tenant context: must see ONLY its own company.
  stamp("proveContexts: withTenant(companyA) -> isolation check");
  const seenByA = await repo.withTenant(a, null, async (c) => {
    const r = await c.query<{ id: string }>("SELECT id FROM companies");
    return r.rows.map((x) => x.id);
  });
  check(
    "withTenant(A): sees its own company",
    seenByA.includes(a),
    `${seenByA.length} row(s) visible`
  );
  check(
    "withTenant(A): CANNOT see company B (company isolation)",
    !seenByA.includes(b),
    "B is not visible to A"
  );

  // (c2) tenant context cannot write into another company.
  stamp("proveContexts: withTenant(A) -> cross-tenant write attempt");
  let crossBlocked = true;
  let crossMsg = "write silently affected 0 other-company rows";
  try {
    await repo.withTenant(a, null, async (c) => {
      const upd = await c.query("UPDATE companies SET name='hijacked' WHERE id=$1", [b]);
      if ((upd.rowCount ?? 0) > 0) {
        crossBlocked = false;
        crossMsg = `UPDATED ${upd.rowCount} row(s) belonging to another company`;
      }
    });
  } catch (e) {
    crossBlocked = true;
    crossMsg = `refused: ${(e as Error).message.slice(0, 70)}`;
  }
  check("withTenant(A): cannot MUTATE another company", crossBlocked, crossMsg);

  await closePool().catch(() => {});
}
async function main(): Promise<void> {
  // Guard rail: this proof must never touch a real database.
  if (!SCRATCH_DB.startsWith("nexora_scratch_iss008_")) {
    throw new Error(`refusing to operate on ${SCRATCH_DB}`);
  }
  for (const p of PROTECTED) {
    if (SCRATCH_DB === p) throw new Error(`refusing protected database ${p}`);
  }

  stamp(`creating scratch database ${SCRATCH_DB}`);
  const admin = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 15_000 });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  await admin.end();

  // --- THE ACTUAL RESET PATH -------------------------------------------
  stamp("resetDatabase()");
  let resetError = "";
  try {
    await resetDatabase(adminUrlFor(SCRATCH_URL));
  } catch (e) {
    resetError = (e as Error).message;
  }
  check("resetDatabase() executes without error", resetError === "", resetError.slice(0, 160));

  // --- migrations against the freshly reset schema ----------------------
  stamp("runMigrations() against the reset schema");
  const applied = await runMigrations(adminUrlFor(SCRATCH_URL));
  check("runMigrations() applies the migration set", applied.length > 0, `${applied.length} applied`);

  // --- privileges on objects created AFTER the reset --------------------
  stamp("verifying privileges / RLS / BYPASSRLS");
  const su = new pg.Client({ connectionString: adminUrlFor(SCRATCH_URL) });
  await su.connect();

  const roleExists = await su.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [APP_ROLE]);
  check("application role exists", (roleExists.rowCount ?? 0) === 1, APP_ROLE);

  for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
    const r = await su.query<{ n: number }>(
      `SELECT count(*)::int n FROM information_schema.table_privileges
        WHERE grantee=$1 AND table_schema='public' AND privilege_type=$2`,
      [APP_ROLE, priv]
    );
    check(
      `app role holds ${priv} on migration-created tables (ALTER DEFAULT PRIVILEGES)`,
      r.rows[0].n > 0,
      `${r.rows[0].n} tables`
    );
  }

  const rls = await su.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relrowsecurity AND c.relname IN
            ('companies','users','customers','loans','payments') ORDER BY c.relname`
  );
  check(
    "RLS still enabled on tenant tables",
    rls.rowCount > 0,
    `RLS on: ${rls.rows.map((r) => r.relname).join(", ")}`
  );

  const byp = await su.query<{ rolbypassrls: boolean }>(
    "SELECT rolbypassrls FROM pg_roles WHERE rolname=$1",
    [APP_ROLE]
  );
  check(
    "app role NOT granted BYPASSRLS (isolation preserved)",
    byp.rows[0]?.rolbypassrls === false,
    `rolbypassrls=${byp.rows[0]?.rolbypassrls}`
  );
  await su.end();

  await proveContexts();
}

void (async () => {
  let code = 0;
  try {
    await main();
    const passed = results.filter((r) => r.ok).length;
    // eslint-disable-next-line no-console -- proof output
    console.log(`\nISS-008 PROOF: ${passed}/${results.length} checks passed`);
    if (passed !== results.length) code = 1;
  } catch (e) {
    // eslint-disable-next-line no-console -- proof output
    console.error("PROOF ERROR:", e);
    code = 1;
  }
  clearTimeout(watchdog);
  await destroyScratch();
  process.exit(code);
})();