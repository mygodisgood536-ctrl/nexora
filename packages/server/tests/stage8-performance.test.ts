// Stage 7E - Performance Calculation Engine (Part 1 §25-A/B/C) +
// collection-officer assignments.
//
// Proves the shared engine computes Expected/Actual/Outstanding/Overdue/
// Collection %/Savings/Customers identically at every level of the hierarchy,
// that totals reconcile (Company = SUM(branches)), that a Collection Officer's
// total is exactly their assigned customer/group records (never company-wide),
// that figures update the instant a verified payment clears the pipeline
// (real-time requirement), and that tenant/branch scope is enforced.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { Express } from "express";
import { seedWorld, withAdmin } from "./fixtures";
import { activateProvider, staffLogin } from "./platform-helpers";
import {
  getPerformanceSummary,
  getStaffPerformanceTable,
  type PerformanceActor
} from "../src/modules/performance/service";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";
const SECRET_A = "alpha-signing-secret-0123456789abcdef";

let runCounter = 0;
function nextRef(prefix: string): string {
  const code = `${Date.now().toString(36)}${runCounter++}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${code}`;
}

function hmacSig(secret: string, ts: string, bodyString: string): string {
  return crypto.createHmac("sha256", secret).update(`${ts}.${bodyString}`).digest("hex");
}

function postWebhook(app: Express, body: object): request.Test {
  const req = request(app)
    .post("/api/v1/webhooks/payments/sandbox")
    .set("X-Nexora-Company", "alpha-test")
    .set("Content-Type", "application/json");
  const ts = String(Math.floor(Date.now() / 1000));
  req.set("X-Nexora-Timestamp", ts);
  req.set("X-Nexora-Signature", hmacSig(SECRET_A, ts, JSON.stringify(body)));
  req.send(JSON.stringify(body));
  return req;
}

// Deterministic "today" so due-date arithmetic is reproducible within a run.
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
const D1 = iso(addDays(new Date(), 60));
const D2 = iso(addDays(new Date(), 90));
const DPAST = iso(addDays(new Date(), -5));

// Wipe every PERF-% artifact (customers, loans, schedules, payments,
// assignments, groups, VAs) plus the accounting/provider artifacts this suite
// creates, and reset the seeded 30000 alpha loan to a known state.
// `seedCompleted: true` (beforeAll) retires the seed loan so the branch/company
// totals this suite asserts on are exactly its own loans; afterAll restores it
// for suites that drive webhook payments against it.
async function resetPerformance(seedCompleted: boolean): Promise<void> {
  await withAdmin(async (db) => {
    await db.query(`
      UPDATE payments SET webhook_event_id=NULL
       WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
         AND provider_txn_ref LIKE 'PERF-%'
    `);
    await db.query(`DELETE FROM webhook_events WHERE provider_event_id LIKE 'PERF-%'`);
    await db.query(`
      DELETE FROM payment_reversals WHERE original_payment_id IN (
        SELECT id FROM payments
         WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
           AND provider_txn_ref LIKE 'PERF-%')
    `);
    for (const tbl of ["unmatched_payments","unallocated_payments",
      "payment_allocations","pipeline_jobs","savings_transactions",
      "reconciliation_items","receipts"]) {
      await db.query(
        `DELETE FROM ${tbl} WHERE payment_id IN (
           SELECT id FROM payments
            WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
              AND provider_txn_ref LIKE 'PERF-%')`
      );
    }
    await db.query(`
      DELETE FROM journal_lines WHERE journal_entry_id IN (
        SELECT id FROM journal_entries
         WHERE payment_id IN (
           SELECT id FROM payments
            WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
              AND provider_txn_ref LIKE 'PERF-%'))
    `);
    await db.query(`
      DELETE FROM journal_entries WHERE payment_id IN (
        SELECT id FROM payments
         WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
           AND provider_txn_ref LIKE 'PERF-%')
    `);
    await db.query(`
      DELETE FROM payments
       WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
         AND provider_txn_ref LIKE 'PERF-%'
    `);
    await db.query(`
      DELETE FROM savings_transactions WHERE savings_account_id IN (
        SELECT sa.id FROM savings_accounts sa
          JOIN customers c ON c.id=sa.customer_id
         WHERE c.customer_code LIKE 'PERF-%')
    `);
    await db.query(`
      DELETE FROM savings_accounts WHERE customer_id IN (
        SELECT id FROM customers WHERE customer_code LIKE 'PERF-%')
    `);
    await db.query(`
      DELETE FROM virtual_accounts WHERE account_number LIKE '555060000%'
    `);
    await db.query(`
      DELETE FROM repayment_schedule_rows WHERE loan_id IN (
        SELECT l.id FROM loans l JOIN customers c ON c.id=l.customer_id
         WHERE c.customer_code LIKE 'PERF-%')
    `);
    await db.query(`
      DELETE FROM loans WHERE customer_id IN (
        SELECT id FROM customers WHERE customer_code LIKE 'PERF-%')
    `);
    await db.query(`
      DELETE FROM loan_applications WHERE customer_id IN (
        SELECT id FROM customers WHERE customer_code LIKE 'PERF-%')
    `);
    await db.query(`
      DELETE FROM group_members WHERE group_id IN (
        SELECT id FROM groups WHERE name LIKE 'PERF-GRP-%')
    `);
    await db.query(`DELETE FROM groups WHERE name LIKE 'PERF-GRP-%'`);
    await db.query(`
      DELETE FROM customer_assignments WHERE company_id IN (
        SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test'))
    `);
    await db.query(`
      DELETE FROM notifications WHERE recipient_customer_id IN (
        SELECT id FROM customers WHERE customer_code LIKE 'PERF-%')
    `);
    await db.query(`
      DELETE FROM customers WHERE customer_code LIKE 'PERF-%'
    `);
    await db.query(`
      DELETE FROM loan_products WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
        AND name='Perf Product'
    `);
    await db.query(`
      DELETE FROM approval_chains WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test')
        AND name='Perf Chain'
    `);
    // Accounting + provider on-ramps this suite touches (mirrors the
    // statements suite so reruns start from a clean chart of accounts).
    await db.query(`
      DELETE FROM journal_lines WHERE journal_entry_id IN (
        SELECT id FROM journal_entries WHERE company_id IN (
          SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test')))
    `);
    await db.query(`
      DELETE FROM journal_entries WHERE company_id IN (
        SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test'))
    `);
    await db.query(`
      DELETE FROM gl_accounts WHERE company_id IN (
        SELECT id FROM companies WHERE slug IN ('alpha-test','beta-test'))
    `);
    await db.query(`DELETE FROM webhook_signing_secrets`);
    await db.query(`DELETE FROM payment_provider_configs`);
    // Seed loan to the requested state.
    if (seedCompleted) {
      await db.query(`
        WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
        UPDATE loans l SET outstanding_principal='0', status='completed', completed_at=now()
          FROM alpha WHERE l.company_id=alpha.company_id AND l.principal_amount='30000'
      `);
    } else {
      await db.query(`
        WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
        UPDATE repayment_schedule_rows rsr
           SET actual_repayment=0, actual_savings=0, paid_at=NULL
          FROM loans l, alpha
         WHERE l.id=rsr.loan_id AND l.company_id=alpha.company_id
           AND l.principal_amount='30000'
      `);
      await db.query(`
        WITH alpha AS (SELECT id AS company_id FROM companies WHERE slug='alpha-test')
        UPDATE loans l
           SET outstanding_principal='30000', status='active', completed_at=NULL
          FROM alpha WHERE l.company_id=alpha.company_id AND l.principal_amount='30000'
      `);
    }
  });
}

async function alphaId(sql: string): Promise<string> {
  let out = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(sql);
    out = r.rows[0]!.id;
  });
  return out;
}

// Seeded world:
//   PERF-CUST-P1 (ALP-001) loan cycle D1 5000/1000 (actual 3000/500), D2 4000/800
//   PERF-CUST-P2 (ALP-002) loan cycle D1 2000/500
//   PERF-CUST-P3 (ALP-002) loan cycle DPAST 1000/200  -> the overdue book
//   PERF-CUST-P4 (ALP-001) loan cycle D1 9000/0       -> unassigned, outside CO scope
// Alice is assigned: customer P1, customer P2, and group PERF-GRP-A2 (member P3).
async function seedPerformance(): Promise<void> {
  await withAdmin(async (db) => {
    const company = (await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug='alpha-test'`)).rows[0]!.id;
    const a1 = (await db.query<{ id: string }>(`SELECT id FROM branches WHERE company_id=$1 AND code='ALP-001'`, [company])).rows[0]!.id;
    const a2 = (await db.query<{ id: string }>(`SELECT id FROM branches WHERE company_id=$1 AND code='ALP-002'`, [company])).rows[0]!.id;
    const alice = (await db.query<{ id: string }>(`SELECT id FROM users WHERE company_id=$1 AND username='alice'`, [company])).rows[0]!.id;
    const mdRole = (await db.query<{ id: string }>(`SELECT id FROM roles WHERE company_id=$1 AND role_key='md'`, [company])).rows[0]!.id;

    const chain = (await db.query<{ id: string }>(
      `INSERT INTO approval_chains (company_id, name) VALUES ($1,'Perf Chain') RETURNING id`,
      [company]
    )).rows[0]!.id;
    await db.query(
      `INSERT INTO approval_chain_steps (company_id, chain_id, stage_order, step_name, role_id)
       VALUES ($1,$2,1,'Approver',$3)`,
      [company, chain, mdRole]
    );
    const product = (await db.query<{ id: string }>(
      `INSERT INTO loan_products (company_id, name, min_principal, max_principal, interest_rate,
                                  cycle_days, cycle_count, expected_repayment_per_cycle,
                                  expected_savings_per_cycle, approval_chain_id)
       VALUES ($1,'Perf Product',10,100000,5,1,1,9000,0,$2) RETURNING id`,
      [company, chain]
    )).rows[0]!.id;

    const customer = async (code: string, branch: string): Promise<string> =>
      (await db.query<{ id: string }>(
        `INSERT INTO customers (company_id, branch_id, customer_code, first_name,
                                last_name, phone, address, status)
         VALUES ($1,$2,$3,'Perf','Customer','0000000000','1 Perf Rd','active') RETURNING id`,
        [company, branch, code]
      )).rows[0]!.id;

    const loan = async (
      custId: string,
      branch: string,
      principal: number,
      repayment: number,
      savings: number,
      cycles: number
    ): Promise<string> => {
      const app = await db.query<{ id: string }>(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                        principal_amount, status, submitted_by, decided_by, disbursed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'disbursed',$7,$7,now()) RETURNING id`,
        [company, branch, custId, product, chain, principal, alice]
      );
      const loanRow = await db.query<{ id: string }>(
        `INSERT INTO loans (company_id, branch_id, customer_id, application_id, product_id,
                            principal_amount, interest_rate, cycle_days, cycle_count,
                            expected_repayment_per_cycle, expected_savings_per_cycle,
                            outstanding_principal, status, disbursed_by)
         VALUES ($1,$2,$3,$4,$5,$6,5,1,$7,$8,$9,$10,'active',$11) RETURNING id`,
        [company, branch, custId, app.rows[0]!.id, product, principal,
         cycles, repayment, savings, principal, alice]
      );
      return loanRow.rows[0]!.id;
    };

    const p1 = await customer("PERF-CUST-P1", a1);
    const p2 = await customer("PERF-CUST-P2", a2);
    const p3 = await customer("PERF-CUST-P3", a2);
    const p4 = await customer("PERF-CUST-P4", a1);

    const l1 = await loan(p1, a1, 6000, 5000, 1000, 2);
    const l2 = await loan(p2, a2, 2000, 2000, 500, 1);
    const l3 = await loan(p3, a2, 1000, 1000, 200, 1);
    const l4 = await loan(p4, a1, 9000, 9000, 0, 1);

    await db.query(
      `INSERT INTO repayment_schedule_rows (company_id, loan_id, cycle_number, due_date,
                                            expected_repayment, expected_savings,
                                            actual_repayment, actual_savings)
       VALUES ($1,$2,1,$3,5000,1000,3000,500), ($1,$2,2,$4,4000,800,0,0)`,
      [company, l1, D1, D2]
    );
    await db.query(
      `INSERT INTO repayment_schedule_rows (company_id, loan_id, cycle_number, due_date,
                                            expected_repayment, expected_savings)
       VALUES ($1,$2,1,$3,2000,500)`,
      [company, l2, D1]
    );
    await db.query(
      `INSERT INTO repayment_schedule_rows (company_id, loan_id, cycle_number, due_date,
                                            expected_repayment, expected_savings)
       VALUES ($1,$2,1,$3,1000,200)`,
      [company, l3, DPAST]
    );
    await db.query(
      `INSERT INTO repayment_schedule_rows (company_id, loan_id, cycle_number, due_date,
                                            expected_repayment, expected_savings)
       VALUES ($1,$2,1,$3,9000,0)`,
      [company, l4, D1]
    );

    await db.query(
      `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
                                     bank_name, account_name, account_number, status)
       VALUES ($1,$2,$3,'sandbox','Perf Bank','Perf P1','5550600001','active')`,
      [company, a1, p1]
    );

    // Assignments: direct customers P1/P2, group PERF-GRP-A2 holds P3.
    const g = (await db.query<{ id: string }>(
      `INSERT INTO groups (company_id, branch_id, name, group_number, group_address, date_created)
       VALUES ($1,$2,'PERF-GRP-A2','PERF-GRP-A2','Performance Group Address','2024-01-01') RETURNING id`,
      [company, a2]
    )).rows[0]!.id;
    await db.query(
      `INSERT INTO company_group_options (company_id, option_kind, option_value, sort_order)
       SELECT $1, v.kind, v.value, v.ord FROM (VALUES
         ('group_role','Leader',1),('group_role','Secretary',2),('group_role','Treasurer',3),
         ('group_role','Chief Whip',4),('group_role','Member',5),
         ('marital_status','Single',1),('marital_status','Married',2),
         ('marital_status','Divorced',3),('marital_status','Widowed',4)
       ) AS v(kind, value, ord)
       ON CONFLICT DO NOTHING`,
      [company]
    );
    await db.query(
      `INSERT INTO group_members (group_id, customer_id, company_id, father_husband_name,
                                  marital_status, phone, group_role, company_options_company_id)
       VALUES ($1,$2,$3,'Performance Father','Single','+2348000000000','Member',$3)`,
      [g, p3, company]
    );
    await db.query(
      `INSERT INTO customer_assignments (company_id, branch_id, staff_id, customer_id, assigned_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [company, a1, alice, p1, alice]
    );
    await db.query(
      `INSERT INTO customer_assignments (company_id, branch_id, staff_id, customer_id, assigned_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [company, a2, alice, p2, alice]
    );
    await db.query(
      `INSERT INTO customer_assignments (company_id, branch_id, staff_id, group_id, assigned_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [company, a2, alice, g, alice]
    );
  });
}

let companyA = "";
let branchA1 = "";
let branchA2 = "";
let aliceUserId = "";
let p1CustomerId = "";

beforeAll(async () => {
  const w = await seedWorld();
  companyA = w.companyA;
  branchA1 = w.branchA1;
  branchA2 = w.branchA2;
  aliceUserId = w.userA;
  await resetPerformance(true);
  await seedPerformance();

  p1CustomerId = await alphaId(`SELECT id FROM customers WHERE customer_code='PERF-CUST-P1'`);

  const app = (await import("../src/app")).createApp();
  await activateProvider(app, {
    host: ALPHA_HOST,
    mdUsername: "amy",
    branchId: branchA1,
    signingSecret: SECRET_A
  });
});

describe("stage 7E - performance engine (company/branch/CO hierarchy)", () => {
  it("computes the company view and reconciles to the sum of its branches", async () => {
    const actor: PerformanceActor = { sub: "suite", companyId: companyA, branchId: null };
    const company = await getPerformanceSummary(actor, { from: D1, to: D1 });
    const a1 = await getPerformanceSummary(actor, { from: D1, to: D1, branchId: branchA1 });
    const a2 = await getPerformanceSummary(actor, { from: D1, to: D1, branchId: branchA2 });

    // Company (§25-B reconciliation: Company Total = SUM(permitted branches)).
    expect(company.performance.expected).toBe("16000.00");
    expect(company.performance.actual).toBe("3000.00");
    expect(company.performance.outstanding).toBe("13000.00");
    expect(company.performance.overdue).toBe("1000.00");
    expect(company.performance.collectionRate).toBe("18.75");
    expect(company.performance.noCollectionsDue).toBe(false);
    expect(company.performance.expectedSavings).toBe("1500.00");
    expect(company.performance.actualSavings).toBe("500.00");
    expect(company.performance.savingsVariance).toBe("-1000.00");
    expect(company.performance.customersExpected).toBe(3);
    expect(company.performance.customersPaid).toBe(1);
    expect(company.performance.customersMissed).toBe(2);
    expect(company.performance.activeCustomers).toBe(4);
    expect(company.performance.activeLoans).toBe(4);
    expect(company.performance.overdueCustomers).toBe(1);

    // Branch A1: P1 + P4 (P4 outside any CO book, still inside the branch).
    expect(a1.performance.expected).toBe("14000.00");
    expect(a1.performance.actual).toBe("3000.00");
    expect(a1.performance.outstanding).toBe("11000.00");
    expect(a1.performance.overdue).toBe("0.00");
    expect(a1.performance.collectionRate).toBe("21.43");
    expect(a1.performance.customersExpected).toBe(2);

    // Branch A2: P2 + the overdue P3.
    expect(a2.performance.expected).toBe("2000.00");
    expect(a2.performance.actual).toBe("0.00");
    expect(a2.performance.outstanding).toBe("2000.00");
    expect(a2.performance.overdue).toBe("1000.00");
    expect(a2.performance.collectionRate).toBe("0.00");

    // Reconciliation is exact at every field.
    const sum = (k: "expected" | "actual" | "outstanding" | "overdue" | "expectedSavings" | "actualSavings") =>
      (Number(a1.performance[k]) + Number(a2.performance[k])).toFixed(2);
    expect(sum("expected")).toBe(company.performance.expected);
    expect(sum("actual")).toBe(company.performance.actual);
    expect(sum("outstanding")).toBe(company.performance.outstanding);
    expect(sum("overdue")).toBe(company.performance.overdue);
    expect(sum("expectedSavings")).toBe(company.performance.expectedSavings);
    expect(sum("actualSavings")).toBe(company.performance.actualSavings);
  });

  it("scopes a Collection Officer total to their assigned customers/groups only", async () => {
    const actor: PerformanceActor = { sub: "suite", companyId: companyA, branchId: null };
    const staff = await getStaffPerformanceTable(actor, { from: D1, to: D1 });
    expect(staff.staff).toHaveLength(1);
    const aliceRow = staff.staff[0]!;
    expect(aliceRow.staffId).toBe(aliceUserId);
    expect(aliceRow.username).toBe("alice");
    expect(aliceRow.assignedCustomers).toBe(2); // P1 + P2 direct
    expect(aliceRow.assignedGroups).toBe(1); // PERF-GRP-A2 (P3)

    // Alice's book = P1+P2 for the period (P3 is due outside it) + the group's
    // P3 inside the as-of-now overdue book. Company-wide Expected is 16000,
    // so this proves the CO view is NOT company-wide: P4 is excluded because
    // it is not assigned.
    expect(aliceRow.performance.expected).toBe("7000.00");
    expect(aliceRow.performance.actual).toBe("3000.00");
    expect(aliceRow.performance.outstanding).toBe("4000.00");
    expect(aliceRow.performance.overdue).toBe("1000.00");
    expect(aliceRow.performance.collectionRate).toBe("42.86");
    expect(aliceRow.performance.expectedSavings).toBe("1500.00");
    expect(aliceRow.performance.actualSavings).toBe("500.00");
    expect(aliceRow.performance.customersExpected).toBe(2);
    expect(aliceRow.performance.customersPaid).toBe(1);
    expect(aliceRow.performance.customersMissed).toBe(1);
    expect(aliceRow.performance.overdueCustomers).toBe(1);

    // Scope Total row for the requested scope (company) still reconciles to the
    // whole permitted book.
    expect(staff.total.expected).toBe("16000.00");
    expect(staff.total.overdue).toBe("1000.00");
  });

  it("has no collections-due semantics for an empty book", async () => {
    const actor: PerformanceActor = { sub: "suite", companyId: companyA, branchId: null };
    // A far-future period with nothing scheduled.
    const empty = await getPerformanceSummary(actor, {
      from: iso(addDays(new Date(), 400)),
      to: iso(addDays(new Date(), 401))
    });
    expect(empty.performance.noCollectionsDue).toBe(true);
    expect(empty.performance.collectionRate).toBeNull();
    expect(empty.performance.expected).toBe("0.00");
    expect(empty.performance.actual).toBe("0.00");
    expect(empty.performance.overdue).toBe("1000.00"); // overdue is an as-of-now book figure
  });
});

describe("stage 7E - performance HTTP surface", () => {
  it("returns the branch-scoped summary and enforces branch scope", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const res = await request(app)
      .get("/api/v1/performance/summary")
      .query({ date: D1 })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // alice is a single-branch principal (ALP-001): her summary is her branch.
    expect(res.body.scope.branchId).toBe(branchA1);
    expect(res.body.performance.expected).toBe("14000.00");
    expect(res.body.performance.actual).toBe("3000.00");

    // A branch-scoped session cannot widen itself to another branch.
    const cross = await request(app)
      .get("/api/v1/performance/summary")
      .query({ date: D1, branchId: branchA2 })
      .set("Authorization", `Bearer ${token}`);
    expect(cross.status).toBe(403);
  });

  it("exposes the branch table with its scope-total row", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .get("/api/v1/performance/branches")
      .query({ date: D1 })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Single-branch principal => one permitted branch row + scope total.
    expect(res.body.branches).toHaveLength(1);
    expect(res.body.branches[0].branchId).toBe(branchA1);
    expect(res.body.branches[0].branchCode).toBe("ALP-001");
    expect(res.body.branches[0].collectionOfficers).toBeGreaterThanOrEqual(1);
    expect(res.body.branches[0].performance.expected).toBe("14000.00");
    expect(res.body.total.expected).toBe(res.body.branches[0].performance.expected);
  });

  it("lists worker performance for assigned staff only", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const res = await request(app)
      .get("/api/v1/performance/staff")
      .query({ date: D1 })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.staff).toHaveLength(1);
    expect(res.body.staff[0].staffId).toBe(aliceUserId);
    // Within her own branch the CO book is P1 (the P2/P3 group are ALP-002).
    expect(res.body.staff[0].performance.expected).toBe("5000.00");
    expect(res.body.staff[0].assignedCustomers).toBe(1);
  });

  it("enforces tenant isolation and input validation", async () => {
    const app = (await import("../src/app")).createApp();
    const { token: alphaToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const betaToken = (await staffLogin(app, BETA_HOST, "bob")).token;

    const beta = await request(app)
      .get("/api/v1/performance/summary")
      .query({ date: D1 })
      .set("Authorization", `Bearer ${betaToken}`);
    expect(beta.status).toBe(200);
    expect(beta.body.performance.expected).toBe("0.00");
    expect(beta.body.performance.noCollectionsDue).toBe(true);

    const badDate = await request(app)
      .get("/api/v1/performance/summary")
      .query({ date: "not-a-date" })
      .set("Authorization", `Bearer ${alphaToken}`);
    expect(badDate.status).toBe(400);

    const noAuth = await request(app).get("/api/v1/performance/summary");
    expect(noAuth.status).toBe(401);
  });
});

describe("stage 7E - assignments", () => {
  it("creates, lists, guards and ends an assignment", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // A throwaway customer for the CRUD lifecycle (no loan => no performance).
    let px = "";
    await withAdmin(async (db) => {
      const company = (await db.query<{ id: string }>(`SELECT id FROM companies WHERE slug='alpha-test'`)).rows[0]!.id;
      px = (await db.query<{ id: string }>(
        `INSERT INTO customers (company_id, branch_id, customer_code, first_name,
                                last_name, phone, address, status)
         VALUES ($1,$2,'PERF-CRUD-CX','Perf','Crud','0','x','active') RETURNING id`,
        [company, branchA1]
      )).rows[0]!.id;
    });

    const created = await request(app)
      .post("/api/v1/customer-assignments")
      .set("Authorization", `Bearer ${token}`)
      .send({ staffId: aliceUserId, customerId: px });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("active");
    expect(created.body.customerId).toBe(px);
    const assignmentId = created.body.id as string;

    // A branch-scoped CO cannot assign a customer from another branch.
    const cross = await request(app)
      .post("/api/v1/customer-assignments")
      .set("Authorization", `Bearer ${token}`)
      .send({ staffId: aliceUserId, customerId: await alphaId(`SELECT id FROM customers WHERE customer_code='PERF-CUST-P2'`) });
    expect(cross.status).toBe(403);

    const ended = await request(app)
      .post(`/api/v1/customer-assignments/${assignmentId}/end`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "test cleanup" });
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe("ended");
    expect(ended.body.endedAt).not.toBeNull();

    const list = await request(app)
      .get("/api/v1/customer-assignments")
      .query({ staffId: aliceUserId })
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.items.some((a: { id: string; status: string }) =>
      a.id === assignmentId && a.status === "ended")).toBe(true);

    await withAdmin(async (db) => {
      await db.query(`DELETE FROM customers WHERE customer_code='PERF-CRUD-CX'`);
    });
  });

  it("audits assignment lifecycles in the tenant trail", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const created = await request(app)
      .post("/api/v1/customer-assignments")
      .set("Authorization", `Bearer ${token}`)
      .send({ staffId: aliceUserId, customerId: p1CustomerId });
    expect(created.status).toBe(201);
    const assignmentId = created.body.id as string;
    await request(app)
      .post(`/api/v1/customer-assignments/${assignmentId}/end`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "audit trail test" });

    const audit = await request(app)
      .get("/api/v1/audit")
      .query({ entityType: "customer_assignments", entityId: assignmentId })
      .set("Authorization", `Bearer ${token}`);
    expect(audit.status).toBe(200);
    const actions = audit.body.items.map((i: { action: string }) => i.action);
    expect(actions).toContain("assignment.created");
    expect(actions).toContain("assignment.ended");

    await withAdmin(async (db) => {
      await db.query(`DELETE FROM customer_assignments WHERE id=$1`, [assignmentId]);
    });
  });
});

describe("stage 7E - real-time recalculation", () => {
  it("reflects a verified payment the instant it clears the pipeline", async () => {
    const app = (await import("../src/app")).createApp();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // Before: P1's D1 row has actual 3000/500.
    const before = await request(app)
      .get("/api/v1/performance/summary")
      .query({ date: D1 })
      .set("Authorization", `Bearer ${token}`);
    expect(before.body.performance.actual).toBe("3000.00");

    let dbActual = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ actual_repayment: string }>(
        `SELECT actual_repayment FROM repayment_schedule_rows rsr
          JOIN loans l ON l.id=rsr.loan_id
          JOIN customers c ON c.id=l.customer_id
         WHERE c.customer_code='PERF-CUST-P1' AND rsr.cycle_number=1`
      );
      dbActual = String(Number(r.rows[0]!.actual_repayment));
    });

    const w = await postWebhook(app, {
      event: "payment.received",
      transaction: { reference: nextRef("PERF-PAY-"), account_number: "5550600001", amount: 1000 }
    });
    expect(w.status).toBe(200);
    expect(w.body.outcome.kind).toBe("pending_allocation");

    // C.O. allocates the pending payment so the ledger row updates.
    const paymentId: string = w.body.outcome.paymentId;
    const perfLoanId = await alphaId(
      `SELECT l.id FROM loans l
        JOIN customers c ON c.id=l.customer_id
       WHERE c.company_id=(SELECT id FROM companies WHERE slug='alpha-test')
         AND c.customer_code='PERF-CUST-P1' AND l.status='active' LIMIT 1`
    );
    const alloc = await request(app)
      .post(`/api/v1/payments/${paymentId}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId: perfLoanId, repaymentAmount: 1000, savingsAmount: 0, note: "perf test allocation" });
    expect(alloc.status).toBe(200);

    // The engine must see the new Actual immediately (no batch, no nightly job).
    const after = await request(app)
      .get("/api/v1/performance/summary")
      .query({ date: D1 })
      .set("Authorization", `Bearer ${token}`);
    expect(after.body.performance.actual).not.toBe("3000.00");

    await withAdmin(async (db) => {
      const r = await db.query<{ actual_repayment: string }>(
        `SELECT actual_repayment FROM repayment_schedule_rows rsr
          JOIN loans l ON l.id=rsr.loan_id
          JOIN customers c ON c.id=l.customer_id
         WHERE c.customer_code='PERF-CUST-P1' AND rsr.cycle_number=1`
      );
      const newActual = String(Number(r.rows[0]!.actual_repayment));
      expect(Number(newActual)).toBeGreaterThan(Number(dbActual));
      expect(after.body.performance.actual).toBe(String(Number(newActual).toFixed(2)));
      expect(after.body.performance.expected).toBe("14000.00");
    });
  });
});

afterAll(async () => {
  await resetPerformance(false);
});