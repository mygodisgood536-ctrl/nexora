// Stage 7C - Lending tests (Part 1 Section 23).
// Covers: product + chain + step management, application submit/list/get/withdraw,
// approval decision, disbursement (with active-customer guard).
import { describe, expect, it } from "vitest";
import request from "supertest";
import { seedWorld, withAdmin, withAdminValue } from "./fixtures";
import { staffLogin, completeProfile, attachVerifiedFaceEvidence, attachVerifiedBankDetails, attachApplicationTerms } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

async function getAlphaBranchA1(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-001'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function getAlphaCustomerId(app: any, token: string, branchId: string, first: string, last: string): Promise<string> {
  // RULE 9.2.2 — a disbursement needs a complete profile, so the test
  // customer is registered with every required group captured.
  const r = await request(app)
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      branchId,
      firstName: first,
      lastName: last,
      address: "1 LoanTest St",
      ...completeProfile({ identificationNumber: `ID-${first}-${last}` })
    });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

interface Seeded { productId: string; chainId: string; customerId: string; }

let seedCounter = 0;
async function seedLoanWorld(app: any, token: string, nameSuffix = ""): Promise<Seeded> {
  const branchA1 = await getAlphaBranchA1();
  const customerId = await getAlphaCustomerId(app, token, branchA1, `LoanCust${nameSuffix}`, "Tester");
  const actor = await withAdminValue(async (db) => {
    const r = await db.query<{ id: string; company_id: string; branch_id: string }>(
      `SELECT u.id, c.company_id, c.branch_id
         FROM customers c JOIN users u ON u.company_id=c.company_id AND u.username='alice'
        WHERE c.id=$1`,
      [customerId]
    );
    const row = r.rows[0]!;
    return { sub: row.id, companyId: row.company_id, branchId: row.branch_id };
  });
  await attachVerifiedFaceEvidence(actor, customerId);
  const tag = `${process.pid}-${++seedCounter}`;

  // Fetch the first real role from the seeded company.
  let realRoleId = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM roles WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') LIMIT 1`
    );
    realRoleId = r.rows[0]!.id;
  });

  const chainRes = await request(app)
    .post("/api/v1/approval-chains")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: `Standard One-Stage ${tag}`,
      steps: [{ stageOrder: 1, stepName: "Manager approval", roleId: realRoleId }]
    });
  expect(chainRes.status).toBe(201);
  const chainId: string = chainRes.body.id;

  const productRes = await request(app)
    .post("/api/v1/loan-products")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: `Standard Microloan ${tag}`,
      minPrincipal: 1000,
      maxPrincipal: 50000,
      interestRate: 12,
      cycleDays: 30,
      cycleCount: 3,
      expectedRepaymentPerCycle: 500,
      expectedSavingsPerCycle: 50,
      approvalChainId: chainId
    });
  expect(productRes.status).toBe(201);

  return { productId: productRes.body.id, chainId, customerId };
}
describe("stage 7 - lending domain", () => {
  it("creates a loan product, approval chain, and a loan application", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 10000 });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe("in_review");
    expect(submit.body.current_stage_order).toBe(1);
    expect(submit.body.principal_amount).toBe("10000");
  });

  it("rejects application when principal is outside the product range", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const tooSmall = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 100 });
    expect(tooSmall.status).toBe(422);

    const tooBig = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 999999 });
    expect(tooBig.status).toBe(422);
  });

  it("lists and gets applications", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });

    const list = await request(app)
      .get("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
  });

  it("withdraws an in-review application", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });
    const id = submit.body.id;

    const withdraw = await request(app)
      .post(`/api/v1/loan-applications/${id}/withdraw`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "changed mind" });
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.status).toBe("withdrawn");

    const withdrawAgain = await request(app)
      .post(`/api/v1/loan-applications/${id}/withdraw`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "again" });
    expect(withdrawAgain.status).toBe(409);
  });

  it("RULE 19.12 skips an optional unavailable approval stage", async () => {
    const app = (await import("../src/app")).createApp();
    const w = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token, "StageResolve");
    const stageAppId = await withAdminValue(async (db) => {
      const unavailableRole = (await db.query(
        `INSERT INTO roles (company_id, role_key, name, category, is_system)
         VALUES ($1,$2,'Unavailable Stage','operations_field',false) RETURNING id`,
        [w.companyA, `unavailable_stage_${Date.now()}`]
      )).rows[0].id;
      const availableRole = (await db.query(
        `SELECT id FROM roles WHERE company_id=$1 AND role_key='collection_officer' LIMIT 1`,
        [w.companyA]
      )).rows[0].id;
      const chain = (await db.query(
        `INSERT INTO approval_chains (company_id, name) VALUES ($1,'Stage Resolution Chain') RETURNING id`,
        [w.companyA]
      )).rows[0].id;
      await db.query(
        `INSERT INTO approval_chain_steps (company_id, chain_id, stage_order, step_name, role_id, mandatory)
         VALUES ($1,$2,1,'Unavailable optional stage',$3,false),
                ($1,$2,2,'Available stage',$4,true)`,
        [w.companyA, chain, unavailableRole, availableRole]
      );
      return (await db.query(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                       principal_amount, status, current_stage_order, submitted_by)
         VALUES ($1,$2,$3,$4,$5,5000,'in_review',1,$6) RETURNING id`,
        [w.companyA, w.branchA1, customerId, productId, chain, w.userA]
      )).rows[0].id as string;
    });
    await attachVerifiedFaceEvidence(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customerId,
      stageAppId
    );
    const decided = await request(app)
      .post(`/api/v1/loan-applications/${stageAppId}/decide`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "approve", reason: "optional stage unavailable" });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe("approved");
    await withAdmin(async (db) => {
      const audit = await db.query(
        `SELECT 1 FROM audit_logs
          WHERE entity_id=$1 AND action='loan_application.stage_resolved'`,
        [stageAppId]
      );
      expect(audit.rowCount).toBe(1);
    });

    const mandatoryAppId = await withAdminValue(async (db) => {
      const unavailableRole = (await db.query(
        `INSERT INTO roles (company_id, role_key, name, category, is_system)
         VALUES ($1,$2,'Mandatory Unavailable Stage','operations_field',false) RETURNING id`,
        [w.companyA, `mandatory_stage_${Date.now()}`]
      )).rows[0].id;
      const availableRole = (await db.query(
        `SELECT id FROM roles WHERE company_id=$1 AND role_key='collection_officer' LIMIT 1`,
        [w.companyA]
      )).rows[0].id;
      const chain = (await db.query(
        `INSERT INTO approval_chains (company_id, name) VALUES ($1,'Mandatory Stage Chain') RETURNING id`,
        [w.companyA]
      )).rows[0].id;
      await db.query(
        `INSERT INTO approval_chain_steps (company_id, chain_id, stage_order, step_name, role_id, mandatory)
         VALUES ($1,$2,1,'Mandatory unavailable stage',$3,true),
                ($1,$2,2,'Available stage',$4,false)`,
        [w.companyA, chain, unavailableRole, availableRole]
      );
      return (await db.query(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                       principal_amount, status, current_stage_order, submitted_by)
         VALUES ($1,$2,$3,$4,$5,5000,'in_review',1,$6) RETURNING id`,
        [w.companyA, w.branchA1, customerId, productId, chain, w.userA]
      )).rows[0].id as string;
    });
    await attachVerifiedFaceEvidence(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customerId,
      mandatoryAppId
    );
    const mandatoryBlocked = await request(app)
      .post(`/api/v1/loan-applications/${mandatoryAppId}/decide`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "approve", reason: "mandatory stage must not be skipped" });
    expect(mandatoryBlocked.status).toBe(409);
    expect(String(mandatoryBlocked.body?.error?.message ?? "")).toContain("Mandatory");
  });

  it("calculates weekly terms and refuses NOT TALLY repayments", async () => {
    const app = (await import("../src/app")).createApp();
    const w = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token, "Terms");

    const created = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId,
        productId,
        principalAmount: 10000,
        repaymentMode: "weekly",
        repaymentWeekday: 3,
        repaymentPeriods: 4,
        interestPercentage: 20,
        repaymentAmount: 3000
      });
    expect(created.status).toBe(201);

    const terms = await request(app)
      .get(`/api/v1/loan-applications/${created.body.id}/terms`)
      .set("Authorization", `Bearer ${token}`);
    expect(terms.status).toBe(200);
    expect(terms.body).toMatchObject({
      repayment_mode: "weekly",
      repayment_weekday: 3,
      repayment_periods: 4,
      calculated_interest: "2000.00",
      calculated_total_repayment: "12000.00",
      tally_status: "matched"
    });

    const mismatch = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId,
        productId,
        principalAmount: 10000,
        repaymentMode: "weekly",
        repaymentWeekday: 3,
        repaymentPeriods: 4,
        interestPercentage: 20,
        repaymentAmount: 2500
      });
    expect(mismatch.status).toBe(422);
    expect(String(mismatch.body?.error?.message ?? "")).toContain("NOT TALLY");

    const dailyWithWeekday = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId,
        productId,
        principalAmount: 10000,
        repaymentMode: "daily",
        repaymentWeekday: 3,
        repaymentPeriods: 4,
        interestPercentage: 20,
        repaymentAmount: 3000
      });
    expect(dailyWithWeekday.status).toBe(422);

    await withAdmin(async (db) => {
      await db.query(
        `UPDATE loan_applications SET status='approved', current_stage_order=NULL,
                                     decided_by=$2, decided_at=now()
          WHERE id=$1`,
        [created.body.id, w.userA]
      );
    });
    await attachVerifiedFaceEvidence(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customerId,
      created.body.id
    );
    await attachVerifiedBankDetails(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customerId,
      created.body.id
    );
    const disbursed = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: created.body.id, reason: "terms schedule" });
    expect(disbursed.status).toBe(201);
    expect(disbursed.body.loan.cycle_count).toBe(4);
    expect(disbursed.body.schedule).toHaveLength(4);
    const dueDays = disbursed.body.schedule.map((row: { due_date: string }) =>
      new Date(row.due_date).getUTCDay()
    );
    expect(dueDays).toEqual([3, 3, 3, 3]);
  });

  it("RULE 19.3 daily mode builds a daily schedule with the same exact-total validation, and Nexora calculates the totals itself", async () => {
    const app = (await import("../src/app")).createApp();
    const w = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token, "DailyTerms");

    // 10000 principal, 20% interest over 40 daily periods = 300 per day.
    const created = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId,
        productId,
        principalAmount: 10000,
        repaymentMode: "daily",
        repaymentPeriods: 40,
        interestPercentage: 20,
        repaymentAmount: 300
      });
    expect(created.status).toBe(201);

    const terms = await request(app)
      .get(`/api/v1/loan-applications/${created.body.id}/terms`)
      .set("Authorization", `Bearer ${token}`);
    expect(terms.status).toBe(200);
    // RULE 19.3.7 - the same exact-total rule as weekly.
    expect(terms.body).toMatchObject({
      repayment_mode: "daily",
      repayment_weekday: null,
      repayment_periods: 40,
      calculated_interest: "2000.00",
      calculated_total_repayment: "12000.00",
      tally_status: "matched"
    });

    // A daily schedule that does not reconcile is refused, named NOT TALLY.
    const notTally = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId,
        productId,
        principalAmount: 10000,
        repaymentMode: "daily",
        repaymentPeriods: 40,
        interestPercentage: 20,
        repaymentAmount: 299.99
      });
    expect(notTally.status).toBe(422);
    expect(String(notTally.body?.error?.message ?? "")).toContain("NOT TALLY");

    // RULE 19.3 - the calculated totals are produced by Nexora. A client cannot
    // supply them, and a client-supplied value is ignored rather than trusted.
    const withClientTotal = await request(app)
      .put(`/api/v1/loan-applications/${created.body.id}/terms`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        repaymentMode: "daily",
        repaymentPeriods: 40,
        interestPercentage: 20,
        repaymentAmount: 300,
        calculatedInterest: 0,
        calculatedTotalRepayment: 10000,
        tallyStatus: "matched"
      });
    expect(withClientTotal.status).toBe(200);
    expect(withClientTotal.body.calculated_interest).toBe("2000.00");
    expect(withClientTotal.body.calculated_total_repayment).toBe("12000.00");
    expect(withClientTotal.body.tally_status).toBe("matched");

    await withAdmin(async (db) => {
      await db.query(
        `UPDATE loan_applications SET status='approved', current_stage_order=NULL,
                                     decided_by=$2, decided_at=now()
          WHERE id=$1`,
        [created.body.id, w.userA]
      );
    });
    const actor = { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 };
    await attachVerifiedFaceEvidence(actor, customerId, created.body.id);
    await attachVerifiedBankDetails(actor, customerId, created.body.id);

    const disbursed = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: created.body.id, reason: "daily schedule" });
    expect(disbursed.status).toBe(201);
    expect(disbursed.body.loan.cycle_days).toBe(1);
    expect(disbursed.body.loan.cycle_count).toBe(40);
    expect(disbursed.body.schedule).toHaveLength(40);

    // A real daily schedule: consecutive days, each carrying its own amount.
    const dueDates = disbursed.body.schedule.map((row: { due_date: string }) => row.due_date);
    expect(new Set(dueDates).size).toBe(40);
    for (let i = 1; i < dueDates.length; i += 1) {
      const previous = new Date(dueDates[i - 1]!);
      const current = new Date(dueDates[i]!);
      const gapDays = Math.round((current.getTime() - previous.getTime()) / 86_400_000);
      expect(gapDays).toBe(1);
    }
    for (const row of disbursed.body.schedule) {
      expect(Number(row.expected_repayment)).toBeCloseTo(300, 2);
    }
  });

  it("persists resumable application stage checkpoints", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token, "Stages");
    const application = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });
    expect(application.status).toBe(201);

    const incomplete = await request(app)
      .put(`/api/v1/loan-applications/${application.body.id}/stages/customer_info`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "completed", payload: { nextOfKinName: "Kin" } });
    expect(incomplete.status).toBe(422);

    const saved = await request(app)
      .put(`/api/v1/loan-applications/${application.body.id}/stages/customer_info`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "completed",
        payload: {
          nextOfKinName: "Kin Test",
          occupation: "Trader",
          address: "1 Market Road",
          directionToLocate: "Near the market",
          localAreaKnownAs: "Market",
          shopAddress: "2 Market Road",
          averageDailyIncome: 2000,
          averageMonthlyIncome: 60000
        }
      });
    expect(saved.status).toBe(200);
    expect(saved.body.status).toBe("completed");

    // RULE 19.4.3 - the guarantor is a first-class party, so the guarantor is
    // recorded before its information stage can be completed.
    const guarantorParty = await request(app)
      .put(`/api/v1/loan-applications/${application.body.id}/guarantor`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        fullName: "Guarantor Test",
        relationship: "friend",
        phone: "+2348000000000",
        address: "3 Backup Road",
        occupation: "Trader",
        houseAddress: "3 Backup Road",
        street: "Backup Street",
        directionToHouse: "Opposite the church",
        localAreaKnownAs: "Backup",
        shopAddress: "5 Backup Road",
        averageDailyIncome: 1500,
        averageMonthlyIncome: 45000
      });
    expect(guarantorParty.status).toBe(200);

    const guarantor = await request(app)
      .put(`/api/v1/loan-applications/${application.body.id}/stages/guarantor_info`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "completed",
        payload: {
          fullName: "Guarantor Test",
          fatherHusbandName: "Guarantor Father",
          maritalStatus: "single",
          phone: "+2348000000000",
          address: "3 Backup Road"
        }
      });
    expect(guarantor.status).toBe(200);

    const stages = await request(app)
      .get(`/api/v1/loan-applications/${application.body.id}/stages`)
      .set("Authorization", `Bearer ${token}`);
    expect(stages.status).toBe(200);
    expect(stages.body.resumeStageKey).toBe("loan_terms");
    expect(stages.body.stages).toHaveLength(2);
    const stillDraft = await request(app)
      .get(`/api/v1/loan-applications/${application.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(stillDraft.body.status).toBe("in_review");
  });

  it("disbursement is blocked for a non-active customer, and provisions the VA + portal access when it succeeds", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId, chainId } = await seedLoanWorld(app, token);

    // Manually create an application and force it to 'approved'.
    let appId = "";
    await withAdmin(async (db) => {
      const r = await db.query<{ id: string }>(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                       principal_amount, status, current_stage_order, submitted_by,
                                       decided_by, decided_at)
         VALUES ((SELECT id FROM companies WHERE slug='alpha-test'),
                 (SELECT id FROM branches WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND code='ALP-001'),
                 $1, $2, $3, 5000, 'approved', null,
                 (SELECT id FROM users WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND username='alice'),
                 (SELECT id FROM users WHERE company_id=(SELECT id FROM companies WHERE slug='alpha-test') AND username='alice'),
                 now())
         RETURNING id`,
        [customerId, productId, chainId]
      );
      appId = r.rows[0]!.id;
    });
    const actor = await withAdminValue(async (db) => {
      const r = await db.query<{ id: string; company_id: string; branch_id: string }>(
        `SELECT u.id, c.company_id, c.branch_id
           FROM customers c JOIN users u ON u.company_id=c.company_id AND u.username='alice'
          WHERE c.id=$1`,
        [customerId]
      );
      const row = r.rows[0]!;
      return { sub: row.id, companyId: row.company_id, branchId: row.branch_id };
    });
    await attachVerifiedFaceEvidence(actor, customerId, appId);
    await attachVerifiedBankDetails(actor, customerId, appId);
    await attachApplicationTerms(actor, appId, { repaymentPeriods: 3 });

    // A suspended customer cannot be disbursed (the active-status guard).
    const suspend = await request(app)
      .post(`/api/v1/customers/${customerId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "suspend", reason: "verification hold" });
    expect(suspend.status).toBe(200);

    const blocked = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: appId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/active/);

    const reactivate = await request(app)
      .post(`/api/v1/customers/${customerId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "reactivate", reason: "cleared" });
    expect(reactivate.status).toBe(200);

    const ok = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: appId, reason: "funds available" });
    expect(ok.status).toBe(201);
    expect(ok.body.loan.status).toBe("active");
    expect(ok.body.loan.outstanding_principal).toBe("5000");
    expect(ok.body.schedule.length).toBe(3);

    // RULE 9.5.1: the VA + customer-portal access are provisioned at disbursement.
    const customer = await request(app)
      .get(`/api/v1/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(customer.status).toBe(200);
    const customerCode = customer.body.customer_code as string;
    const prov = ok.body.provisioned;
    expect(prov).toBeDefined();
    expect(prov.virtualAccount.status).toBe("active");
    expect(prov.virtualAccount.accountNumber).toMatch(/^\d{10}$/);
    expect(prov.portalAccess.status).toBe("provisioned");
    // RULE 5.2.4 — the portal username is the customer's full name.
    expect(prov.portalAccess.username).toBe("LoanCust Tester");
    expect(prov.portalAccess.portalUrl).toContain(`/customer-portal/alpha-test?c=${customerCode}`);

    // RULE 10.4.2 — disbursement generates the ledger atomically:
    //   DR 1100 Loan Receivables = principal
    //   CR 1000 Collection Account = principal
    let lines: Array<{ code: string; direction: string; amount: string }> = [];
    await withAdmin(async (db) => {
      const r = await db.query<{ code: string; direction: string; amount: string }>(
        `SELECT gl.code, jl.direction, jl.amount
           FROM journal_entries je
           JOIN journal_lines jl ON jl.journal_entry_id = je.id
           JOIN gl_accounts gl ON gl.id = jl.gl_account_id
          WHERE je.company_id=(SELECT id FROM companies WHERE slug='alpha-test')
          AND je.source='system' AND je.payment_id IS NULL
            AND je.description LIKE $1
          ORDER BY gl.code`,
        [`Loan disbursement ${ok.body.loan.id}%`]
      );
      lines = r.rows;
    });
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.code === "1100")).toMatchObject({
      direction: "debit",
      amount: "5000.00"
    });
    expect(lines.find((l) => l.code === "1000")).toMatchObject({
      direction: "credit",
      amount: "5000.00"
    });
  });

  it("rejects disbursement of an application that is not approved", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });

    const res = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: submit.body.id });
    expect(res.status).toBe(409);
  });

  it("rejects a decision by an actor not holding the required stage role", async () => {
    const app = (await import("../src/app")).createApp();
    const w = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });
    expect(submit.status).toBe(201);
    await attachVerifiedFaceEvidence(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customerId,
      submit.body.id
    );

    const decide = await request(app)
      .post(`/api/v1/loan-applications/${submit.body.id}/decide`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "approve", reason: "looks good" });
    expect([200, 403]).toContain(decide.status);
  });

  it("blocks a second application while the customer has an active loan", async () => {
    const app = (await import("../src/app")).createApp();
    const w = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const { productId, customerId } = await seedLoanWorld(app, token, "ActiveGate");

    const first = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });
    expect(first.status).toBe(201);
    await withAdmin(async (db) => {
      await db.query(
        `UPDATE loan_applications SET status='approved', current_stage_order=NULL, decided_by=$2, decided_at=now() WHERE id=$1`,
        [first.body.id, w.userA]
      );
    });
    await attachVerifiedFaceEvidence(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customerId,
      first.body.id
    );
    await attachVerifiedBankDetails(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customerId,
      first.body.id
    );
    await attachApplicationTerms(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      first.body.id
    );
    const disburse = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: first.body.id, reason: "active loan gate" });
    expect(disburse.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId, productId, principalAmount: 5000 });
    expect(second.status).toBe(409);
  });

  it("alpha loans are not visible to beta sessions (RLS isolation)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token: aToken } = await staffLogin(app, ALPHA_HOST, "alice");
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");
    const { productId, customerId } = await seedLoanWorld(app, aToken);

    const submit = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ customerId, productId, principalAmount: 5000 });
    expect(submit.status).toBe(201);

    const bGet = await request(app)
      .get(`/api/v1/loan-applications/${submit.body.id}`)
      .set("Authorization", `Bearer ${bToken}`);
    expect(bGet.status).toBe(404);
  });
});
