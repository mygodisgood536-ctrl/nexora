import pg from "pg";

const TEST_URL = process.env.DATABASE_URL ?? "postgres://nexora:nexora@localhost:5432/nexora_test";
export const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/postgres";

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

    const user = async (c: uuid, b: uuid | null, code: string, uname: string): Promise<uuid> =>
      (await db.query(
        `INSERT INTO users (company_id, branch_id, worker_code, username, password_hash,
                            first_name, last_name, birth_day, birth_month, status, must_change_password)
         VALUES ($1,$2,$3,$4,'x','Test','Worker',1,1,'active',false) RETURNING id`,
        [c, b, code, uname]
      )).rows[0].id;

    const userA = await user(companyA, branchA1, "W001", "alice");
    const userB = await user(companyB, branchB1, "W001", "bob");

    const mdRoleA = (await db.query(
      `INSERT INTO roles (company_id, role_key, name, category, is_system)
       VALUES ($1,'md','MD','executive',true) RETURNING id`,
      [companyA]
    )).rows[0].id as uuid;

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

