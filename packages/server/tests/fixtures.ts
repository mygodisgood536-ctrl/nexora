import bcrypt from "bcryptjs";
import pg from "pg";

const TEST_URL = process.env.DATABASE_URL ?? "postgres://nexora:nexora@localhost:5432/nexora_test";
export const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/postgres";

/** Shared known password for seeded login-enabled users. */
export const SEED_PASSWORD = "TestPassword!123";
const SEED_HASH = bcrypt.hashSync(SEED_PASSWORD, 8);

type uuid = string;

export interface TestWorld {
  companyA: string;
  companyB: string;
  branchA1: string;
  branchA2: string;
  branchB1: string;
  userA: string;
  userB: string;
  customerA1: string;
  customerA2: string;
  customerB1: string;
  vaA1: string;
  loanA1: string;
}

let cached: TestWorld | null = null;

export function adminUrlForTest(): string {
  const admin = new URL(ADMIN_URL);
  admin.pathname = new URL(TEST_URL).pathname;
  return admin.toString();
}

export async function withAdmin(fn: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrlForTest() });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

/** Opens an app-role (nexora) connection with explicit session GUCs. */
export async function withAppSession(
  configs: Record<string, string | null>,
  fn: (client: pg.Client) => Promise<void>
): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_URL });
  await client.connect();
  try {
    for (const [key, value] of Object.entries(configs)) {
      await client.query("SELECT set_config($1, $2, false)", [key, value === null ? "" : value]);
    }
    await fn(client);
  } finally {
    await client.end();
  }
}

async function loadWorld(db: pg.Client): Promise<TestWorld> {
  const one = async (sql: string, params: unknown[]): Promise<uuid> => {
    const row = (await db.query<{ id: uuid }>(sql, params)).rows[0];
    if (!row) throw new Error(`loadWorld: no row for ${sql}`);
    return row.id;
  };

  const companyA = await one(`SELECT id FROM companies WHERE slug='alpha-test'`, []);
  const companyB = await one(`SELECT id FROM companies WHERE slug='beta-test'`, []);
  const branchA1 = await one(`SELECT id FROM branches WHERE company_id=$1 AND code='ALP-001'`, [companyA]);
  const branchA2 = await one(`SELECT id FROM branches WHERE company_id=$1 AND code='ALP-002'`, [companyA]);
  const branchB1 = await one(`SELECT id FROM branches WHERE company_id=$1 AND code='BTA-001'`, [companyB]);
  const userA = await one(`SELECT id FROM users WHERE company_id=$1 AND worker_code='W001'`, [companyA]);
  const userB = await one(`SELECT id FROM users WHERE company_id=$1 AND worker_code='W001'`, [companyB]);
  const customerA1 = await one(`SELECT id FROM customers WHERE company_id=$1 AND customer_code='CUST-0001'`, [companyA]);
  const customerA2 = await one(`SELECT id FROM customers WHERE company_id=$1 AND customer_code='CUST-0002'`, [companyA]);
  const customerB1 = await one(`SELECT id FROM customers WHERE company_id=$1 AND customer_code='CUST-0001'`, [companyB]);
  const vaA1 = await one(`SELECT id FROM virtual_accounts WHERE company_id=$1 AND account_number='1000000001'`, [companyA]);
  const loanA1 = await one(`SELECT id FROM loans WHERE company_id=$1 LIMIT 1`, [companyA]);
  // Stage 2 entities are part of the world's completeness contract.
  await one(
    `SELECT ra.id FROM role_assignments ra
      JOIN roles r ON r.id = ra.role_id
     WHERE ra.user_id=$1 AND r.role_key='collection_officer' LIMIT 1`,
    [userA]
  );

  return { companyA, companyB, branchA1, branchA2, branchB1, userA, userB, customerA1, customerA2, customerB1, vaA1, loanA1 };
}

/** Idempotently seeds two isolated companies with branches/users/customers/VA/loan.
 *  Rebuilds from scratch whenever the stored world is incomplete or mutated,
 *  and serializes concurrent vitest workers via an advisory lock. */
export async function seedWorld(): Promise<TestWorld> {
  if (cached) return cached;

  await withAdmin(async (db) => {
    await db.query("BEGIN");
    await db.query("SELECT set_config('app.bypass_rls', 'on', true)");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('nexora-seed-world'))");

    let world: TestWorld | null = null;
    try {
      world = await loadWorld(db);
    } catch {
      world = null;
    }

    if (!world) {
      await db.query(`TRUNCATE TABLE companies CASCADE`);
      world = await insertWorld(db);
    } else {
      // Reset artifacts that integrity tests mutate, so reruns stay deterministic.
      await db.query(
        `DELETE FROM payments WHERE provider_txn_ref IN ('TX-TEST-001','TX-NEG-001','TX-IMM-001')`
      );
      await db.query(`DELETE FROM virtual_accounts WHERE account_number = '3000000001'`);
      await db.query(
        `UPDATE virtual_accounts SET status='active' WHERE account_number='1000000001'`
      );
      await db.query(
        `DELETE FROM customers WHERE customer_code = 'CUST-7777'
            OR (first_name = 'Dup' AND last_name = 'One')`
      );
      await db.query(
        `UPDATE customers c SET status='active'
           FROM companies co
          WHERE co.id = c.company_id AND co.slug = 'alpha-test'`
      );
      // Reset Stage 2 lifecycle mutations: credentials, flags, sessions.
      await db.query(
        `UPDATE users u SET password_hash=$1, must_change_password=false,
                temp_password_expires_at=NULL, status='active'
           FROM companies c
          WHERE c.id=u.company_id AND c.slug IN ('alpha-test','beta-test')
            AND u.username IN ('alice','bob')`,
        [SEED_HASH]
      );

      // Restore canonical Stage 2 assignments (tests end/mutate them).
      const idOf = async (sql: string, params: unknown[]): Promise<uuid> => {
        const row = (await db.query<{ id: uuid }>(sql, params)).rows[0];
        if (!row) throw new Error(`fixture reset: missing row for ${sql}`);
        return row.id;
      };
      const companyA = await idOf(`SELECT id FROM companies WHERE slug='alpha-test'`, []);
      const companyB = await idOf(`SELECT id FROM companies WHERE slug='beta-test'`, []);
      const branchA1 = await idOf(`SELECT id FROM branches WHERE company_id=$1 AND code='ALP-001'`, [companyA]);
      const userA = await idOf(`SELECT id FROM users WHERE company_id=$1 AND username='alice'`, [companyA]);
      const userB = await idOf(`SELECT id FROM users WHERE company_id=$1 AND username='bob'`, [companyB]);
      const coRole = await idOf(`SELECT id FROM roles WHERE company_id=$1 AND role_key='collection_officer'`, [companyA]);
      const bmRole = await idOf(`SELECT id FROM roles WHERE company_id=$1 AND role_key='branch_manager'`, [companyA]);
      const mdRole = await idOf(`SELECT id FROM roles WHERE company_id=$1 AND role_key='md'`, [companyB]);

      await db.query(
        `DELETE FROM role_assignments ra USING users u, companies c
          WHERE ra.user_id=u.id AND c.id=u.company_id AND c.slug IN ('alpha-test','beta-test')`
      );
      const day = 24 * 60 * 60 * 1000;
      const coId = (
        await db.query(
          `INSERT INTO role_assignments (company_id,user_id,role_id,scope_type,assignment_type,starts_at,status,assigned_by)
           VALUES ($1,$2,$3,'single_branch','permanent', now() - interval '10 days','active',$2) RETURNING id`,
          [companyA, userA, coRole]
        )
      ).rows[0]!.id;
      const bmId = (
        await db.query(
          `INSERT INTO role_assignments (company_id,user_id,role_id,scope_type,assignment_type,starts_at,ends_at,status,assigned_by)
           VALUES ($1,$2,$3,'single_branch','temporary', $4, $5,'active',$2) RETURNING id`,
          [companyA, userA, bmRole, new Date(Date.now() - day), new Date(Date.now() + day)]
        )
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO role_assignments (company_id,user_id,role_id,scope_type,assignment_type,starts_at,status,assigned_by)
         VALUES ($1,$2,$3,'company_wide','permanent', now(),'active',$2)`,
        [companyB, userB, mdRole]
      );
      await db.query(`INSERT INTO role_assignment_branches VALUES ($1,$2),($3,$4)`, [
        coId,
        branchA1,
        bmId,
        branchA1
      ]);

      // tempuser: expired temporary credential, restored or recreated.
      const tempReset = await db.query(
        `UPDATE users u SET password_hash=$1, must_change_password=true,
                temp_password_expires_at = now() - interval '1 hour', status='active'
           FROM companies c
          WHERE c.id=u.company_id AND c.slug='alpha-test' AND u.username='tempuser'`,
        [SEED_HASH]
      );
      if (tempReset.rowCount === 0) {
        const branchA1b = await idOf(`SELECT id FROM branches WHERE company_id=$1 AND code='ALP-001'`, [companyA]);
        await db.query(
          `INSERT INTO users (company_id, branch_id, worker_code, username, password_hash,
                              first_name, last_name, birth_day, birth_month, status,
                              must_change_password, temp_password_expires_at)
           VALUES ($1,$2,'W003','tempuser',$3,'Temp','User',1,1,'active',true,
                   now() - interval '1 hour')`,
          [companyA, branchA1b, SEED_HASH]
        );
      }
      await db.query(
        `DELETE FROM refresh_tokens rt USING users u, companies c
          WHERE rt.user_id=u.id AND c.id=u.company_id
            AND c.slug IN ('alpha-test','beta-test')`
      );

      // Heal counters so they always exist and sit past existing codes
      // (Stage 5 never-reuse contract survives any prior run's mutations).
      await db.query(
        `INSERT INTO company_counters (company_id, counter_key, next_value)
         SELECT sub.company_id, sub.counter_key, sub.floor + 1
           FROM (
             SELECT c.id AS company_id, 'branch_seq' AS counter_key,
                    COALESCE(NULLIF(regexp_replace(max(b.code), '^.*-', ''), '')::int, 0) AS floor
               FROM companies c JOIN branches b ON b.company_id=c.id
              WHERE c.slug IN ('alpha-test','beta-test') GROUP BY c.id
             UNION ALL
             SELECT c.id, 'customer_seq',
                    COALESCE(NULLIF(regexp_replace(max(cu.customer_code), '^.*-', ''), '')::int, 0)
               FROM companies c JOIN customers cu ON cu.company_id=c.id
              WHERE c.slug IN ('alpha-test','beta-test') GROUP BY c.id
           ) sub
         ON CONFLICT (company_id, counter_key)
         DO UPDATE SET next_value = GREATEST(company_counters.next_value, EXCLUDED.next_value)`
      );
    }

    await db.query("COMMIT");
    cached = world;
  });

  return cached!;
}

async function insertWorld(db: pg.Client): Promise<TestWorld> {

    const companyA = (await db.query(
      `INSERT INTO companies (name, code_prefix, slug, status)
       VALUES ('Alpha Test Co', 'ALP', 'alpha-test', 'active') RETURNING id`
    )).rows[0].id as uuid;
    const companyB = (await db.query(
      `INSERT INTO companies (name, code_prefix, slug, status)
       VALUES ('Beta Test Co', 'BTA', 'beta-test', 'active') RETURNING id`
    )).rows[0].id as uuid;

    for (const c of [companyA, companyB]) {
      await db.query(`INSERT INTO themes (company_id) VALUES ($1)`, [c]);
      await db.query(`INSERT INTO company_settings (company_id) VALUES ($1)`, [c]);
    }

    const branch = async (c: uuid, code: string, slug: string, name: string): Promise<uuid> =>
      (await db.query(
        `INSERT INTO branches (company_id, code, slug, name, address, portal_url)
         VALUES ($1,$2,$3,$4,'1 Test Rd',$5) RETURNING id`,
        [c, code, slug, name, `${slug}.example.test`]
      )).rows[0].id;

    const branchA1 = await branch(companyA, "ALP-001", "abj", "Abuja");
    const branchA2 = await branch(companyA, "ALP-002", "knj", "Kano");
    const branchB1 = await branch(companyB, "BTA-001", "los", "Lagos");

    const user = async (
      c: uuid,
      b: uuid | null,
      code: string,
      uname: string,
      opts: { mustChange?: boolean; tempExpiresPast?: boolean } = {}
    ): Promise<uuid> =>
      (await db.query(
        `INSERT INTO users (company_id, branch_id, worker_code, username, password_hash,
                            first_name, last_name, birth_day, birth_month, status,
                            must_change_password, temp_password_expires_at)
         VALUES ($1,$2,$3,$4,$5,'Test','Worker',1,1,'active',$6,$7) RETURNING id`,
        [
          c,
          b,
          code,
          uname,
          SEED_HASH,
          opts.mustChange ?? false,
          opts.tempExpiresPast ? new Date(Date.now() - 60 * 60 * 1000) : null
        ]
      )).rows[0].id;

    const userA = await user(companyA, branchA1, "W001", "alice");
    const userB = await user(companyB, branchB1, "W001", "bob");

    const mdRoleA = (await db.query(
      `INSERT INTO roles (company_id, role_key, name, category, is_system)
       VALUES ($1,'md','MD','executive',true) RETURNING id`,
      [companyA]
    )).rows[0].id as uuid;

    // --- Stage 2 auth fixtures: roles, permission bundles, assignments ---
    const role = async (c: uuid, key: string, name: string, category: string): Promise<uuid> =>
      (await db.query(
        `INSERT INTO roles (company_id, role_key, name, category, is_system)
         VALUES ($1,$2,$3,$4,true) RETURNING id`,
        [c, key, name, category]
      )).rows[0].id;

    const coRoleA = await role(companyA, "collection_officer", "Collection Officer", "operations_field");
    const bmRoleA = await role(companyA, "branch_manager", "Branch Manager", "operations_field");
    const mdRoleB = await role(companyB, "md", "MD", "executive");

    const grant = async (roleId: uuid, verbs: string[]): Promise<void> => {
      for (const verb of verbs) {
        await db.query(`INSERT INTO role_permissions (role_id, verb) VALUES ($1,$2)`, [roleId, verb]);
      }
    };
    await grant(coRoleA, ["view", "create", "export"]);
    await grant(bmRoleA, ["view", "approve", "assign", "suspend", "edit"]);
    await db.query(
      `INSERT INTO role_permissions (role_id, verb) SELECT $1, verb FROM permission_verbs`,
      [mdRoleB]
    );
    await db.query(
      `INSERT INTO role_permissions (role_id, verb) SELECT $1, verb FROM permission_verbs`,
      [mdRoleA]
    );

    const assignment = async (
      c: uuid,
      u: uuid,
      roleId: uuid,
      scopeType: string,
      opts: { type?: string; starts?: Date; ends?: Date | null } = {}
    ): Promise<uuid> =>
      (await db.query(
        `INSERT INTO role_assignments (company_id, user_id, role_id, scope_type,
                                       assignment_type, starts_at, ends_at, status, assigned_by)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()), $7, 'active', $2) RETURNING id`,
        [c, u, roleId, scopeType, opts.type ?? "permanent", opts.starts ?? null, opts.ends ?? null]
      )).rows[0].id;

    const day = 24 * 60 * 60 * 1000;
    const aliceCo = await assignment(companyA, userA, coRoleA, "single_branch");
    const aliceBm = await assignment(companyA, userA, bmRoleA, "single_branch", {
      type: "temporary",
      starts: new Date(Date.now() - day),
      ends: new Date(Date.now() + day)
    });
    await db.query(`INSERT INTO role_assignment_branches VALUES ($1,$2), ($3,$4)`, [
      aliceCo,
      branchA1,
      aliceBm,
      branchA1
    ]);
    await assignment(companyB, userB, mdRoleB, "company_wide");

    // Expired temporary-password user for the login lifecycle test.
    await user(companyA, branchA1, "W003", "tempuser", {
      mustChange: true,
      tempExpiresPast: true
    });

    const chainA = (await db.query(
      `INSERT INTO approval_chains (company_id, name) VALUES ($1,'default') RETURNING id`,
      [companyA]
    )).rows[0].id as uuid;
    await db.query(
      `INSERT INTO approval_chain_steps (company_id, chain_id, stage_order, step_name, role_id)
       VALUES ($1,$2,1,'Executive approval',$3)`,
      [companyA, chainA, mdRoleA]
    );

    const productA = (await db.query(
      `INSERT INTO loan_products (company_id, name, min_principal, max_principal, interest_rate,
                                  cycle_days, cycle_count, expected_repayment_per_cycle,
                                  expected_savings_per_cycle, approval_chain_id)
       VALUES ($1,'Standard',1000,100000,5,1,30,4000,1000,$2) RETURNING id`,
      [companyA, chainA]
    )).rows[0].id as uuid;

    const customer = async (c: uuid, b: uuid, code: string, first: string): Promise<uuid> =>
      (await db.query(
        `INSERT INTO customers (company_id, branch_id, customer_code, first_name, last_name, address, status)
         VALUES ($1,$2,$3,$4,'Okon','1 Market Rd','active') RETURNING id`,
        [c, b, code, first]
      )).rows[0].id;

    const customerA1 = await customer(companyA, branchA1, "CUST-0001", "Ada");
    const customerA2 = await customer(companyA, branchA2, "CUST-0002", "Bola");
    const customerB1 = await customer(companyB, branchB1, "CUST-0001", "Chidi");

    // Counters must start PAST every manually-inserted code so Stage 5
    // allocation never collides with fixture rows (never-reused contract).
    await db.query(
      `INSERT INTO company_counters (company_id, counter_key, next_value)
       VALUES ($1,'branch_seq',3),($1,'customer_seq',3),
              ($2,'branch_seq',2),($2,'customer_seq',2)
       ON CONFLICT (company_id, counter_key) DO UPDATE
         SET next_value = EXCLUDED.next_value`,
      [companyA, companyB]
    );

    const vaA1 = (await db.query(
      `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
                                     bank_name, account_name, account_number, provider_reference, status)
       VALUES ($1,$2,$3,'sandbox','Test Bank','Ada Okon','1000000001','ref-va-a1','active') RETURNING id`,
      [companyA, branchA1, customerA1]
    )).rows[0].id as uuid;

    await db.query(
      `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
                                     bank_name, account_name, account_number, provider_reference, status)
       VALUES ($1,$2,$3,'sandbox','Test Bank','Chidi Okon','2000000001','ref-va-b1','active')`,
      [companyB, branchB1, customerB1]
    );

    const app = (await db.query(
      `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                      principal_amount, status, submitted_by, decided_by, disbursed_at)
       VALUES ($1,$2,$3,$4,$5,30000,'disbursed',$6,$6,now()) RETURNING id`,
      [companyA, branchA1, customerA1, productA, chainA, userA]
    )).rows[0].id as uuid;

    const loanA1 = (await db.query(
      `INSERT INTO loans (company_id, branch_id, customer_id, application_id, product_id,
                          principal_amount, interest_rate, cycle_days, cycle_count,
                          expected_repayment_per_cycle, expected_savings_per_cycle,
                          outstanding_principal, status, disbursed_by)
       VALUES ($1,$2,$3,$4,$5,30000,5,1,30,4000,1000,30000,'active',$6) RETURNING id`,
      [companyA, branchA1, customerA1, app, productA, userA]
    )).rows[0].id as uuid;

    await db.query(
      `INSERT INTO repayment_schedule_rows (company_id, loan_id, cycle_number, due_date,
                                            expected_repayment, expected_savings)
       SELECT $1, $2, gs, current_date + gs, 4000, 1000 FROM generate_series(1,30) gs`,
      [companyA, loanA1]
    );

    return { companyA, companyB, branchA1, branchA2, branchB1, userA, userB, customerA1, customerA2, customerB1, vaA1, loanA1 };
}

