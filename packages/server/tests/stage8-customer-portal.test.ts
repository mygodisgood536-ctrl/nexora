// Stage 7F - Customer Portal E2E (Part 1 §22, Part 2 §25, product
// override: VA + portal are provisioned at LOAN DISBURSEMENT).
// Proves the full journey: register -> apply -> disburse (VA + portal access
// provisioned) -> staff portal-access view -> customer login with full-name
// initial password -> scoped portal reads (me/loans/savings/payments/
// receipts/virtual-account) -> per-customer isolation.
import { describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { seedWorld, withAdmin, type TestWorld } from "./fixtures";
import { staffLogin, completeProfile, attachVerifiedFaceEvidence, attachVerifiedBankDetails, attachApplicationTerms } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";

describe("stage 7 - customer portal", () => {
  it("provisions VA + portal at disbursement and authenticates the customer", async () => {
    const app = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();

    // Enable the customer portal for the company (login gate).
    await withAdmin(async (db) => {
      await db.query(
        `UPDATE company_settings SET customer_portal_enabled=true WHERE company_id=$1`,
        [w.companyA]
      );
    });

    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    // 1. Register: no VA is created at onboarding.
    const created = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
       .send({
         branchId: w.branchA1, firstName: "Portal", lastName: "Test", address: "1 Portal Way",
         ...completeProfile({ identificationNumber: "ID-Portal" })
       });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("active");
    expect(created.body.virtualAccount).toBeNull();
    const customerId = created.body.id as string;
    const customerCode = created.body.customerCode as string;

    // 2. Force an approved application for the seeded standard product.
    let appId = "";
    await withAdmin(async (db) => {
      const product = await db.query<{ id: string }>(
        `SELECT id FROM loan_products WHERE company_id=$1 LIMIT 1`, [w.companyA]
      );
      const chain = await db.query<{ id: string }>(
        `SELECT id FROM approval_chains WHERE company_id=$1 LIMIT 1`, [w.companyA]
      );
      const r = await db.query<{ id: string }>(
        `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                       principal_amount, status, current_stage_order, submitted_by,
                                       decided_by, decided_at)
         VALUES ($1,$2,$3,$4,$5,5000,'approved',null,$6,$6,now())
         RETURNING id`,
        [w.companyA, w.branchA1, customerId, product.rows[0]!.id, chain.rows[0]!.id, w.userA]
      );
      appId = r.rows[0]!.id;
    });
    await attachVerifiedFaceEvidence(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customerId,
      appId
    );
    await attachVerifiedBankDetails(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customerId,
      appId
    );
      await attachApplicationTerms(
        { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
        appId
      );

    // 3. Disburse: VA + portal access are provisioned AT DISBURSEMENT.
    const disburse = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: appId, reason: "portal e2e" });
    expect(disburse.status).toBe(201);
    const provisioned = disburse.body.provisioned;
    expect(provisioned.virtualAccount).not.toBeNull();
    expect(provisioned.virtualAccount.status).toBe("active");
    expect(provisioned.virtualAccount.provider).toBe("sandbox");
    expect(provisioned.virtualAccount.accountName).toBe("Portal Test");
    expect(provisioned.virtualAccount.accountNumber).toMatch(/^\d{10}$/);
    expect(provisioned.portalAccess).not.toBeNull();
    expect(provisioned.portalAccess.status).toBe("provisioned");
    // RULE 5.2.4 / Test 18 — full name is the username; @FirstName is the
    // one-time initial password.
    expect(provisioned.portalAccess.username).toBe("Portal Test");
    expect(provisioned.portalAccess.portalUrl).toContain("/customer-portal/alpha-test?c=");
    expect(provisioned.portalAccess.customerCode).toBe(customerCode);
    const loanId = disburse.body.loan.id as string;

    // 4. Staff can read the provisioned portal credentials (C.O. dashboard).
    const staffView = await request(app)
      .get(`/api/v1/customers/${customerId}/portal-access`)
      .set("Authorization", `Bearer ${token}`);
    expect(staffView.status).toBe(200);
    expect(staffView.body.provisioned).toBe(true);
    expect(staffView.body.username).toBe("Portal Test");
    expect(staffView.body.initialPassword).toBe("@Portal");
    expect(staffView.body.status).toBe("provisioned");
    expect(staffView.body.portalUrl).toContain("/customer-portal/alpha-test?c=");

    // 5. Portal enabled-check (public pre-auth).
    const enabled = await request(app)
      .get(`/api/v1/customer-portal/enabled?company=alpha-test`);
    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);

    // 6. Login with the full-name initial password.
    const login = await request(app)
      .post("/api/v1/customer-portal/login")
      .send({ company: "alpha-test", identifier: "Portal Test", password: "@Portal" });
    expect(login.status).toBe(200);
    expect(login.body.customer.customerCode).toBe(customerCode);
    const portalToken = login.body.token as string;

    // 7. Scoped portal reads.
    const me = await request(app)
      .get("/api/v1/customer-portal/me")
      .set("Authorization", `Bearer ${portalToken}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(customerId);
    expect(me.body.customerCode).toBe(customerCode);

    const loans = await request(app)
      .get("/api/v1/customer-portal/loans")
      .set("Authorization", `Bearer ${portalToken}`);
    expect(loans.status).toBe(200);
    expect(loans.body).toHaveLength(1);
    expect(loans.body[0].id).toBe(loanId);
    expect(loans.body[0].status).toBe("active");
    expect(loans.body[0].outstandingPrincipal).toBe("5000");

    const detail = await request(app)
      .get(`/api/v1/customer-portal/loans/${loanId}`)
      .set("Authorization", `Bearer ${portalToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.repaymentSchedule.length).toBeGreaterThan(0);

    const savings = await request(app)
      .get("/api/v1/customer-portal/savings")
      .set("Authorization", `Bearer ${portalToken}`);
    expect(savings.status).toBe(200);
    expect(savings.body).toHaveProperty("accountId");

    const va = await request(app)
      .get("/api/v1/customer-portal/virtual-account")
      .set("Authorization", `Bearer ${portalToken}`);
    expect(va.status).toBe(200);
    expect(va.body.accountNumber).toBe(provisioned.virtualAccount.accountNumber);
    expect(va.body.status).toBe("active");

    const payments = await request(app)
      .get("/api/v1/customer-portal/payments")
      .set("Authorization", `Bearer ${portalToken}`);
    expect(payments.status).toBe(200);

    const receipts = await request(app)
      .get("/api/v1/customer-portal/receipts")
      .set("Authorization", `Bearer ${portalToken}`);
    expect(receipts.status).toBe(200);

    // 8. Per-customer isolation.
    // (a) Wrong password is rejected.
    const bad = await request(app)
      .post("/api/v1/customer-portal/login")
      .send({ company: "alpha-test", identifier: "Portal Test", password: "wrong-password" });
    expect(bad.status).toBe(401);

    // (b) A second customer cannot read the first customer's data.
    const other = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId: w.branchA1, firstName: "Other", lastName: "Person", address: "2 Portal Way" });
    expect(other.status).toBe(201);
    const otherId = other.body.id as string;
    const otherCode = other.body.customerCode as string;
    await withAdmin(async (db) => {
      const hash = bcrypt.hashSync("@Other", 10);
      await db.query(
        `INSERT INTO customer_portal_access
           (company_id, branch_id, customer_id, portal_url, username, password_hash, status)
         VALUES ((SELECT company_id FROM customers WHERE id=$1),
                 (SELECT branch_id FROM customers WHERE id=$1),
                 $1, 'http://localhost:5173/customer-portal/alpha-test?c=' || $2,
                 'Other Person', $3, 'provisioned')`,
        [otherId, otherCode, hash]
      );
    });
    const otherLogin = await request(app)
      .post("/api/v1/customer-portal/login")
      .send({ company: "alpha-test", identifier: "Other Person", password: "@Other" });
    expect(otherLogin.status).toBe(200);
    const otherToken = otherLogin.body.token as string;

    const otherMe = await request(app)
      .get("/api/v1/customer-portal/me")
      .set("Authorization", `Bearer ${otherToken}`);
    expect(otherMe.status).toBe(200);
    expect(otherMe.body.id).toBe(otherId);

    const crossLoan = await request(app)
      .get(`/api/v1/customer-portal/loans/${loanId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(crossLoan.status).toBe(404);

    // (c) A company with the portal disabled rejects login outright.
    const disabled = await request(app)
      .post("/api/v1/customer-portal/login")
      .send({ company: "beta-test", identifier: "CUST-0001", password: "any" });
    expect(disabled.status).toBe(403);

    // (d) A non-customer JWT is refused by the portal middleware.
    const staffRefused = await request(app)
      .get("/api/v1/customer-portal/me")
      .set("Authorization", `Bearer ${token}`);
    expect(staffRefused.status).toBe(401);
  });

  // RULE 5.2.4 — a same-name collision must never let one customer read
  // another's records through an ambiguous username lookup.
  it("refuses a second customer whose full name collides in the same company", async () => {
    const app = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const mk = async (first: string, last: string) => {
      const r = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${token}`)
         .send({
           branchId: w.branchA1, firstName: first, lastName: last, address: "1 Dup Way",
           ...completeProfile({ identificationNumber: `ID-Dup-${first}-${last}-${Date.now()}` })
         });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };

    const firstId = await mk("Same", "Name");
    const secondId = await mk("Same", "Name");

    const disburse = async (customerId: string): Promise<string> => {
      let appId = "";
      await withAdmin(async (db) => {
        const prod = await db.query<{ id: string }>(
          `SELECT id FROM loan_products WHERE company_id=$1 LIMIT 1`, [w.companyA]
        );
        const chain = await db.query<{ id: string }>(
          `SELECT id FROM approval_chains WHERE company_id=$1 LIMIT 1`, [w.companyA]
        );
        const r = await db.query<{ id: string }>(
          `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
                                         principal_amount, status, current_stage_order, submitted_by,
                                         decided_by, decided_at)
           VALUES ($1,$2,$3,$4,$5,5000,'approved',NULL,$6,$6,now()) RETURNING id`,
          [w.companyA, w.branchA1, customerId, prod.rows[0]!.id, chain.rows[0]!.id, w.userA]
        );
         appId = r.rows[0]!.id;
       });
       await attachVerifiedFaceEvidence(
         { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
         customerId,
         appId
       );
       await attachVerifiedBankDetails(
         { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
         customerId,
         appId
       );
        await attachApplicationTerms(
          { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
          appId
        );
       return appId;
    };

    const app1 = await disburse(firstId);
    const res1 = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: app1, reason: "dup one" });
    expect(res1.status).toBe(201);
    expect(res1.body.provisioned.portalAccess.username).toBe("Same Name");

    const app2 = await disburse(secondId);
    const res2 = await request(app)
      .post("/api/v1/loan-disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({ applicationId: app2, reason: "dup two" });
    expect(res2.status).toBe(409);
    expect(String((res2.body as { error?: { message?: string } }).error?.message ?? ""))
      .toContain("already in use");
  });
});
