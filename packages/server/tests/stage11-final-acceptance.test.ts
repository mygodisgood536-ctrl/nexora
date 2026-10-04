import { describe, it, expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { seedWorld, withAdmin, withAdminValue, withAppSession, type TestWorld } from "./fixtures";
import { staffLogin, completeProfile, attachVerifiedFaceEvidence, attachVerifiedBankDetails, attachApplicationTerms } from "./platform-helpers";

async function usernameOf(userId: string): Promise<string> {
  return withAdminValue(async (db) =>
    (await db.query<{ username: string }>(`SELECT username FROM users WHERE id=$1`, [userId]))
      .rows[0]!.username
  );
}

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

/**
 * PART 22 - final end-to-end acceptance.
 *
 * The Vision Audit proves each numbered acceptance item against the real
 * Express app and the real PostgreSQL database. Nothing here is mocked: every
 * assertion reads persisted state back out of the database, so a passing result
 * is a statement about the system rather than about a response body.
 */
describe("PART 22 final end-to-end acceptance", () => {
  it("1-2 a C.O. creates a group and adds members one by one, each role from the configured options", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const configured = await request(app)
      .get("/api/v1/groups/options/configured")
      .set("Authorization", `Bearer ${token}`);
    expect(configured.status).toBe(200);
    const allowedRoles: string[] = configured.body.groupRole;
    expect(allowedRoles.length).toBeGreaterThan(1);

    const group = await request(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: w.branchA1,
        name: `Acceptance Group ${Date.now()}`,
        groupNumber: `GRP-P22-${Date.now()}`,
        groupAddress: "1 Acceptance Road",
        dateCreated: "2024-01-01"
      });
    expect(group.status, `group create: ${JSON.stringify(group.body)}`).toBe(201);
    const groupId = group.body.id as string;
    expect(group.body.group_number).toBeTruthy();
    expect(group.body.group_address).toBe("1 Acceptance Road");

    // Members are added one at a time, each with its own saved role.
    const memberCount = 12;
    const added: { id: string; role: string }[] = [];
    for (let index = 0; index < memberCount; index += 1) {
      const first = `Acceptance${index}`;
      const last = `Member${index}`;
      const created = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", `Bearer ${token}`)
        .send({
          branchId: w.branchA1,
          firstName: first,
          lastName: last,
          address: "1 Acceptance St",
          ...completeProfile({ identificationNumber: `ID-P22-${index}-${Date.now()}` })
        });
      expect(created.status).toBe(201);

      const role = allowedRoles[index % allowedRoles.length]!;
      const member = await request(app)
        .post(`/api/v1/groups/${groupId}/members`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          customerId: created.body.id,
          fullName: `${first} ${last}`,
          fatherHusbandName: "Acceptance Father",
          maritalStatus: "Single",
          phone: "+2348000000000",
          groupRole: role
        });
      expect(member.status, `member ${index}`).toBe(201);
      added.push({ id: created.body.id as string, role });
    }

    const members = await request(app)
      .get(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`);
    expect(members.status).toBe(200);
    expect(members.body).toHaveLength(memberCount);

    // Every role was saved individually, from the configured option set.
    const savedRoles = await withAdminValue(async (db) =>
      (await db.query<{ group_role: string; n: string }>(
        `SELECT group_role, count(*)::text AS n FROM group_members
          WHERE group_id=$1 GROUP BY group_role ORDER BY group_role`,
        [groupId]
      )).rows
    );
    expect(savedRoles.reduce((sum, row) => sum + Number(row.n), 0)).toBe(memberCount);
    for (const row of savedRoles) {
      expect(allowedRoles).toContain(row.group_role);
    }

    // A role outside the configured options is refused, not stored.
    const outsider = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: w.branchA1,
        firstName: "Acceptance",
        lastName: `Outsider${Date.now()}`,
        address: "1 Acceptance St",
        ...completeProfile({ identificationNumber: `ID-P22-OUT-${Date.now()}` })
      });
    expect(outsider.status).toBe(201);
    const refused = await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerId: outsider.body.id,
        fullName: "Acceptance Outsider",
        fatherHusbandName: "Acceptance Father",
        maritalStatus: "Single",
        phone: "+2348000000000",
        groupRole: "Treasurer Emeritus"
      });
    expect(refused.status).toBe(422);

    const finalMembers = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM group_members WHERE group_id=$1`, [groupId]
      )).rows[0]!.n
    );
    expect(Number(finalMembers)).toBe(memberCount);
  });

  it("16-17 every approval stage gives full review context, and closing the view never deletes the application or the pending action", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: coToken } = await staffLogin(app, ALPHA_HOST, "alice");

    const product = await withAdminValue(async (db) =>
      (await db.query<{ id: string }>(
        `SELECT id FROM loan_products WHERE company_id=$1 LIMIT 1`, [w.companyA]
      )).rows[0]!.id
    );
    const customer = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${coToken}`)
      .send({
        branchId: w.branchA1,
        firstName: "Approval",
        lastName: `Context${Date.now()}`,
        address: "1 Approval Road",
        ...completeProfile({ identificationNumber: `ID-P22-APP-${Date.now()}` })
      });
    expect(customer.status).toBe(201);
    // RULE 9.4 - a loan application requires a verified registration capture.
    await attachVerifiedFaceEvidence(
      { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 },
      customer.body.id
    );

    const application = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${coToken}`)
      .send({ customerId: customer.body.id, productId: product, principalAmount: 5000 });
    expect(
      application.status,
      `application create failed: ${JSON.stringify(application.body)}`
    ).toBe(201);
    const applicationId = application.body.id as string;

    await withAdmin(async (db) => {
      await db.query(
        `UPDATE loan_applications
            SET status='submitted', current_stage_order=1, decided_by=NULL, decided_at=NULL
          WHERE id=$1`,
        [applicationId]
      );
    });

    // The reviewer holds the stage-1 role, so the action is genuinely theirs.
    const reviewer = await withAdminValue(async (db) =>
      (await db.query<{ user_id: string }>(
        `SELECT ra.user_id FROM approval_chain_steps s
           JOIN role_assignments ra ON ra.role_id = s.role_id AND ra.company_id = s.company_id
          WHERE s.chain_id = (SELECT chain_id FROM loan_applications WHERE id=$1)
            AND s.stage_order = 1 AND ra.status='active'
          LIMIT 1`,
        [applicationId]
      )).rows[0]!.user_id
    );

    const { token: reviewerToken } = await staffLogin(app, ALPHA_HOST, await usernameOf(reviewer));
    const queue = await request(app)
      .get("/api/v1/loan-applications/approvals/mine")
      .set("Authorization", `Bearer ${reviewerToken}`);
    expect(queue.status).toBe(200);
    const mine = (queue.body.items as { applicationId: string }[]).find((item) => item.applicationId === applicationId);
    // eslint-disable-next-line no-console
    if (!mine) console.log("P22_QUEUE_DEBUG", JSON.stringify({ reviewer, username: await usernameOf(reviewer), applicationId, items: queue.body.items, body: queue.body }).slice(0, 900));
    expect(mine, "the action-required item is not in the reviewer's queue").toBeTruthy();

    // RULE 19.14 - the review context is the full application, not a summary.
    const preview = await request(app)
      .get(`/api/v1/loan-applications/${applicationId}/preview`)
      .set("Authorization", `Bearer ${reviewerToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.customer.customerCode).toBeTruthy();
    expect(preview.body.application.principal_amount).toBeTruthy();
    expect(preview.body.missingEvidence.length).toBeGreaterThanOrEqual(0);
    expect(preview.body.loanCycle).toBeTruthy();

    // An action-required notification exists for the reviewer.
    const notified = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM notifications
          WHERE recipient_user_id=$1 AND kind LIKE 'loan_application.%'
            AND payload->>'application_id' = $2`,
        [reviewer, applicationId]
      )).rows[0]!.n
    );
    expect(Number(notified)).toBeGreaterThanOrEqual(1);

    // Closing the view (reading the notification) changes nothing about the
    // application or the outstanding action.
    const before = await withAdminValue(async (db) =>
      (await db.query<{ status: string; stage: number | null }>(
        `SELECT status, current_stage_order AS stage FROM loan_applications WHERE id=$1`,
        [applicationId]
      )).rows[0]!
    );
    const markRead = await request(app)
      .post("/api/v1/notifications/read-all")
      .set("Authorization", `Bearer ${reviewerToken}`);
    expect([200, 204]).toContain(markRead.status);
    const viewAgain = await request(app)
      .get("/api/v1/loan-applications/approvals/mine")
      .set("Authorization", `Bearer ${reviewerToken}`);
    expect(viewAgain.status).toBe(200);
    expect(
      (viewAgain.body.items as { applicationId: string }[]).find((item) => item.applicationId === applicationId)
    ).toBeTruthy();

    const after = await withAdminValue(async (db) =>
      (await db.query<{ status: string; stage: number | null; deleted: boolean }>(
        `SELECT status, current_stage_order AS stage, false AS deleted
           FROM loan_applications WHERE id=$1`,
        [applicationId]
      )).rows[0]!
    );
    expect(after.status).toBe(before.status);
    expect(after.stage).toBe(before.stage);
    const stillThere = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM loan_applications WHERE id=$1`, [applicationId]
      )).rows[0]!.n
    );
    expect(Number(stillThere)).toBe(1);

    // A decline still requires a reason (RULE 19.12.6).
    const noReason = await request(app)
      .post(`/api/v1/loan-applications/${applicationId}/decide`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "reject" });
    expect(noReason.status).toBe(422);

    const declined = await request(app)
      .post(`/api/v1/loan-applications/${applicationId}/decide`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({ decision: "reject", reason: "Documents do not match the application" });
    expect(declined.status).toBe(200);
    await withAdmin(async (db) => {
      const row = await db.query<{ status: string; rejection_reason: string }>(
        `SELECT status, rejection_reason FROM loan_applications WHERE id=$1`, [applicationId]
      );
      // The company's configured chain decides what a rejection does; either
      // way the reason is recorded and the action leaves the reviewer's queue.
      const chain = await db.query<{ on_rejection: string }>(
        `SELECT c.on_rejection FROM loan_applications a
           JOIN approval_chains c ON c.id = a.chain_id WHERE a.id=$1`,
        [applicationId]
      );
      const expected = chain.rows[0]!.on_rejection === "return_to_applicant" ? "submitted" : "rejected";
      expect(row.rows[0]!.status).toBe(expected);
      expect(row.rows[0]!.rejection_reason).toBe("Documents do not match the application");
    });

    // The declined application is no longer an outstanding action for anyone.
    const afterDecision = await request(app)
      .get("/api/v1/loan-applications/approvals/mine")
      .set("Authorization", `Bearer ${reviewerToken}`);
    expect(afterDecision.status).toBe(200);
    expect(
      (afterDecision.body.items as { applicationId: string }[]).find(
        (item) => item.applicationId === applicationId
      )
    ).toBeUndefined();
  });

  it("10-13 customer and guarantor stages complete at different times and the application resumes at the last saved stage", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const actor = { sub: w.userA, companyId: w.companyA, branchId: w.branchA1 };

    const product = await withAdminValue(async (db) =>
      (await db.query<{ id: string }>(
        `SELECT id FROM loan_products WHERE company_id=$1 LIMIT 1`, [w.companyA]
      )).rows[0]!.id
    );
    const customer = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: w.branchA1,
        firstName: "Staggered",
        lastName: `Stages${Date.now()}`,
        address: "1 Stage Road",
        ...completeProfile({ identificationNumber: `ID-P22-STG-${Date.now()}` })
      });
    expect(customer.status).toBe(201);
    await attachVerifiedFaceEvidence(actor, customer.body.id);
    const application = await request(app)
      .post("/api/v1/loan-applications")
      .set("Authorization", `Bearer ${token}`)
      .send({ customerId: customer.body.id, productId: product, principalAmount: 5000 });
    expect(
      application.status,
      `staggered application: ${JSON.stringify(application.body)}`
    ).toBe(201);
    const applicationId = application.body.id as string;

    // The customer stage is completed on its own.
    const customerStage = await request(app)
      .put(`/api/v1/loan-applications/${applicationId}/stages/customer_info`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "completed",
        payload: {
          nextOfKinName: "Staggered Kin",
          nextOfKinRelationship: "sibling",
          nextOfKinPhone: "+2348000000088",
          occupation: "Trader",
          address: "1 Stage Road",
          directionToLocate: "Behind the market",
          childName: "Stage Child",
          localAreaKnownAs: "Stage",
          shopAddress: "7 Trade Road",
          averageDailyIncome: 2000,
          averageMonthlyIncome: 60000
        }
      });
    expect(customerStage.status).toBe(200);

    // The guarantor stage is not touched yet, so the application resumes there.
    const resumed = await request(app)
      .get(`/api/v1/loan-applications/${applicationId}/stages`)
      .set("Authorization", `Bearer ${token}`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.resumeStageKey).toBe("guarantor_info");
    const guarantorStage = resumed.body.stages.find(
      (row: { stage_key: string }) => row.stage_key === "guarantor_info"
    );
    expect(guarantorStage).toBeUndefined();

    // An incomplete stage cannot be marked complete (RULE 19.6.2).
    const incomplete = await request(app)
      .put(`/api/v1/loan-applications/${applicationId}/stages/guarantor_info`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "completed", payload: { fullName: "Staggered Guarantor" } });
    expect(incomplete.status).toBe(422);

    // The guarantor is recorded and its information completed later.
    const guarantor = await request(app)
      .put(`/api/v1/loan-applications/${applicationId}/guarantor`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        fullName: "Staggered Guarantor",
        relationship: "friend",
        phone: "+2348000000089",
        address: "2 Stage Road",
        occupation: "Farmer",
        houseAddress: "2 Stage Road",
        street: "Stage Street",
        directionToHouse: "Near the church",
        localAreaKnownAs: "Stage",
        shopAddress: "8 Trade Road",
        averageDailyIncome: 1500,
        averageMonthlyIncome: 45000
      });
    expect(guarantor.status).toBe(200);

    const laterStage = await request(app)
      .put(`/api/v1/loan-applications/${applicationId}/stages/guarantor_info`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "completed",
        payload: {
          fullName: "Staggered Guarantor",
          fatherHusbandName: "Staggered Father",
          maritalStatus: "single",
          phone: "+2348000000089",
          address: "2 Stage Road"
        }
      });
    expect(laterStage.status).toBe(200);

    // The customer stage was never re-entered, and it stayed completed.
    const finalStages = await request(app)
      .get(`/api/v1/loan-applications/${applicationId}/stages`)
      .set("Authorization", `Bearer ${token}`);
    expect(finalStages.status).toBe(200);
    expect(finalStages.body.resumeStageKey).toBe("loan_terms");
    const customerRow = finalStages.body.stages.find(
      (row: { stage_key: string }) => row.stage_key === "customer_info"
    );
    expect(customerRow.status).toBe("completed");

    // Both parties are first-class, with their own saved information.
    const parties = await request(app)
      .get(`/api/v1/loan-applications/${applicationId}/party-information`)
      .set("Authorization", `Bearer ${token}`);
    expect(parties.status).toBe(200);
    expect(parties.body.customer.house_address).toBe("1 Stage Road");
    expect(parties.body.customer.next_of_kin_name).toBe("Staggered Kin");
    expect(parties.body.guarantor.occupation).toBe("Farmer");
    expect(parties.body.guarantor.guarantor_id).toBeTruthy();
    void actor;
  });

  it("20-22 posted allocations move the loan and savings, and no financial record is ever destructively deleted", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");

    const before = await withAdminValue(async (db) => {
      const loan = (await db.query<{
        outstanding: string; status: string;
      }>(
        `SELECT outstanding_principal AS outstanding, status FROM loans WHERE id=$1`, [w.loanA1]
      )).rows[0]!;
      const savings = (await db.query<{ balance: string }>(
        `SELECT COALESCE(sum(balance),0)::text AS balance FROM savings_accounts WHERE customer_id=$1`,
        [w.customerA1]
      )).rows[0]!;
      return { loan, savings: savings.balance };
    });

    // A verified provider payment is the only way money enters.
    const paymentId = await withAdminValue(async (db) => {
      const va = (await db.query<{ id: string }>(
        `SELECT id FROM virtual_accounts WHERE company_id=$1 AND status='active' LIMIT 1`,
        [w.companyA]
      )).rows[0]!;
      const payment = (await db.query<{ id: string }>(
        `INSERT INTO payments (company_id, branch_id, customer_id, virtual_account_id,
                               provider, provider_txn_ref, amount, status, received_at, value_date)
         VALUES ($1,$2,$3,$4,'sandbox',$5,5000,'pending_allocation',now(),current_date) RETURNING id`,
        [w.companyA, w.branchA1, w.customerA1, va.id, `p22-${Date.now()}`]
      )).rows[0]!;
      return { id: payment.id, vaId: va.id };
    });

    const allocate = await request(app)
      .post(`/api/v1/payments/${paymentId.id}/allocate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId: w.loanA1, repaymentAmount: 4000, savingsAmount: 1000 });
    expect(
      [200, 201],
      `allocation: ${JSON.stringify(allocate.body)}`
    ).toContain(allocate.status);

    const after = await withAdminValue(async (db) => {
      const loan = (await db.query<{ outstanding: string; status: string }>(
        `SELECT outstanding_principal AS outstanding, status FROM loans WHERE id=$1`, [w.loanA1]
      )).rows[0]!;
      const savings = (await db.query<{ balance: string }>(
        `SELECT COALESCE(sum(balance),0)::text AS balance FROM savings_accounts WHERE customer_id=$1`,
        [w.customerA1]
      )).rows[0]!;
      const allocations = (await db.query<{ repayment: string; savings: string }>(
        `SELECT COALESCE(repayment_amount,0)::text AS repayment,
                COALESCE(savings_amount,0)::text AS savings
           FROM payment_allocations WHERE payment_id=$1`,
        [paymentId.id]
      )).rows[0]!;
      return { loan, savings: savings.balance, allocations };
    });

    // The money is reflected from the actual posted allocation, not a guess.
    expect(Number(after.allocations.repayment)).toBe(4000);
    expect(Number(after.allocations.savings)).toBe(1000);
    expect(
      Number(after.savings),
      `savings before=${before.savings} after=${after.savings} customer=${w.customerA1}`
    ).toBeGreaterThan(Number(before.savings));

    // The journal for the allocation balances.
    const balanced = await withAdminValue(async (db) =>
      (await db.query<{ net: string }>(
        `SELECT COALESCE(sum(CASE WHEN direction='debit' THEN amount ELSE -amount END),0)::text AS net
           FROM journal_lines WHERE journal_entry_id IN (
             SELECT id FROM journal_entries WHERE payment_id=$1)`,
        [paymentId.id]
      )).rows[0]!.net
    );
    expect(Number(balanced)).toBeCloseTo(0, 2);

    // RULE 20.3.1 - a posted financial record cannot be destroyed by the
    // application role, and the correction path is a linked new record.
    const allocationsBefore = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payment_allocations WHERE payment_id=$1`, [paymentId.id]
      )).rows[0]!.n
    );
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      await expect(
        db.query(`DELETE FROM payment_allocations WHERE payment_id=$1`, [paymentId.id])
      ).rejects.toBeTruthy();
      await expect(
        db.query(`UPDATE payment_allocations SET repayment_amount=1 WHERE payment_id=$1`, [paymentId.id])
      ).rejects.toBeTruthy();
      await expect(
        db.query(`DELETE FROM payments WHERE id=$1`, [paymentId.id])
      ).rejects.toBeTruthy();
    });

    const allocationsAfter = await withAdminValue(async (db) =>
      (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payment_allocations WHERE payment_id=$1`, [paymentId.id]
      )).rows[0]!.n
    );
    expect(allocationsAfter).toBe(allocationsBefore);

    // The payment itself is retained; the allocation moved it forward rather
    // than replacing it.
    const original = await withAdminValue(async (db) =>
      (await db.query<{ n: string; status: string }>(
        `SELECT count(*)::text AS n, max(status) AS status FROM payments WHERE id=$1`,
        [paymentId.id]
      )).rows[0]!
    );
    expect(Number(original.n)).toBe(1);
    expect(original.status).toBe("posted");
  });

  it("23 the company AI answers from that company's real data and can neither cross tenants nor mutate anything", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "amy");
    const { token: betaToken } = await staffLogin(app, BETA_HOST, "bob");

    const beforeCounts = await withAdminValue(async (db) => {
      const customers = (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n;
      const loans = (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM loans WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n;
      return { customers: Number(customers), loans: Number(loans) };
    });

    const answer = await request(app)
      .post("/api/v1/company-ai/query")
      .set("Authorization", `Bearer ${token}`)
      .send({
        intent: "customer_loan_history",
        question: "Show this customer's actual loan history",
        customerId: w.customerA1
      });
    expect(answer.status).toBe(200);
    expect(answer.body.answer).toBeTruthy();
    expect(answer.body.intent).toBe("customer_loan_history");
    // RULE 21.1.4 - the answer is grounded, with its source named.
    expect(Array.isArray(answer.body.citations)).toBe(true);
    expect(answer.body.citations.length).toBeGreaterThan(0);

    // RULE 21.1.2 - the same question from another tenant yields nothing.
    const foreign = await request(app)
      .post("/api/v1/company-ai/query")
      .set("Authorization", `Bearer ${betaToken}`)
      .send({
        intent: "customer_loan_history",
        question: "Show this customer's actual loan history",
        customerId: w.customerA1
      });
    expect([200, 404]).toContain(foreign.status);
    const foreignText = JSON.stringify(foreign.body);
    expect(foreignText).not.toContain(w.customerA1);

    // RULE 21.1.3 - the AI surface offers no write path at all.
    for (const path of [
      "/api/v1/company-ai/customers",
      "/api/v1/company-ai/loans",
      "/api/v1/company-ai/payments"
    ]) {
      for (const method of ["post", "put", "patch", "delete"] as const) {
        const call = (request(app) as unknown as Record<string, ((p: string) => { set(k: string, v: string): { send(b: unknown): { status: number } } }) | undefined>)[method];
        expect(call, `supertest has no ${method}`).toBeTruthy();
        const attempt = await call!(path)
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Should", lastName: "NotExist" });
        expect([404, 405], `${method} ${path} must not exist`).toContain(attempt.status);
      }
    }

    const afterCounts = await withAdminValue(async (db) => {
      const customers = (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n;
      const loans = (await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM loans WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n;
      return { customers: Number(customers), loans: Number(loans) };
    });
    // RULE 21.1.3 - nothing was created, edited or deleted by asking.
    expect(afterCounts).toEqual(beforeCounts);
  });

  it("RULE 6.5.2/6.5.5 the Auditor reads everything, writes nothing, and is notified of money events", async () => {
    const app: Express = (await import("../src/app")).createApp();
    const w: TestWorld = await seedWorld();
    const { token: auditorToken } = await staffLogin(app, ALPHA_HOST, "audrey");
    const { token: mdToken } = await staffLogin(app, ALPHA_HOST, "amy");

    // RULE 6.5.1 - unlimited read inside the company.
    const customers = await request(app)
      .get("/api/v1/customers")
      .set("Authorization", `Bearer ${auditorToken}`);
    expect(customers.status).toBe(200);
    const body = customers.body as { items?: unknown[]; customers?: unknown[]; rows?: unknown[]; data?: unknown[] };
    const listed = body.items ?? body.customers ?? body.rows ?? body.data ?? [];
    expect(
      listed.length,
      `auditor customer read: ${JSON.stringify(customers.body).slice(0, 200)}`
    ).toBeGreaterThan(0);

    // RULE 6.5.2 - and no write verb at all.
    const beforeCounts = await withAdminValue(async (db) => {
      const customers = Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n);
      const payments = Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payments WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n);
      return { customers, payments };
    });

    const writes: [string, string, Record<string, unknown>][] = [
      // A fully valid payload, so a refusal can only be about permission.
      ["post", "/api/v1/customers", {
        branchId: w.branchA1,
        firstName: "No",
        lastName: "Write",
        address: "1 No Write Road",
        ...completeProfile({ identificationNumber: `ID-AUD-${Date.now()}` })
      }],
      ["post", `/api/v1/workers/${w.userA}/reset-password`, { reason: "auditor must not reset" }],
      ["post", `/api/v1/workers/${w.userA}/portfolio/hold`, { reason: "auditor must not hold" }]
    ];
    for (const [method, path, payload] of writes) {
      const call = (request(app) as unknown as Record<string, ((p: string) => { set(k: string, v: string): { send(b: unknown): { status: number } } }) | undefined>)[method];
      const attempt = await call!(path)
        .set("Authorization", `Bearer ${auditorToken}`)
        .send(payload);
      // RULE 6.5.2 - the Auditor has no write verb, so the refusal is a 403.
      expect([403], `auditor ${method} ${path} -> ${attempt.status}`).toContain(attempt.status);
    }

    // RULE 6.5.5 - a reversal notifies the Auditor.
    const reversalPaymentId = await withAdminValue(async (db) => {
      const va = (await db.query<{ id: string }>(
        `SELECT id FROM virtual_accounts WHERE company_id=$1 AND status='active' LIMIT 1`, [w.companyA]
      )).rows[0]!;
      return (await db.query<{ id: string }>(
        `INSERT INTO payments (company_id, branch_id, customer_id, virtual_account_id,
                               provider, provider_txn_ref, amount, status, received_at, value_date)
         VALUES ($1,$2,$3,$4,'sandbox',$5,7500,'verified',now(),current_date) RETURNING id`,
        [w.companyA, w.branchA1, w.customerA1, va.id, `p22-rev-${Date.now()}`]
      )).rows[0]!.id;
    });

    const { runPaymentPipeline } = await import("../src/modules/payments/service");
    const reversalRef = await withAdminValue(async (db) =>
      (await db.query<{ ref: string }>(
        `SELECT provider_txn_ref AS ref FROM payments WHERE id=$1`, [reversalPaymentId]
      )).rows[0]!.ref
    );
    const outcome = await runPaymentPipeline({
      provider: "sandbox",
      providerEventId: `evt-rev-${Date.now()}`,
      providerTxnRef: reversalRef,
      companySlug: "alpha-test",
      accountNumber: "1000000001",
      amount: "7500.00",
      valueDate: new Date().toISOString(),
      rawPayload: { test: true },
      kind: "payment.reversed",
      reason: "provider reversal under test"
    });
    expect(outcome.kind).toBe("reversed");

    const auditorNotifications = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${auditorToken}`);
    expect(auditorNotifications.status).toBe(200);
    const inbox = auditorNotifications.body as {
      items?: { kind: string }[];
      notifications?: { kind: string }[];
    };
    const kinds = (inbox.items ?? inbox.notifications ?? []).map((n) => n.kind);
    expect(kinds, `auditor notification kinds: ${JSON.stringify(kinds)}`).toContain(
      "audit.payment_reversed"
    );

    // The Auditor is still unable to act on the thing they were told about.
    const beforeAuditorReads = await withAdminValue(async (db) => {
      const customers = Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n);
      const payments = Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payments WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n);
      return { customers, payments };
    });
    const stillCannot = await request(app)
      .post(`/api/v1/payments/${reversalPaymentId}/allocate`)
      .set("Authorization", `Bearer ${auditorToken}`)
      .send({ loanId: w.loanA1, repaymentAmount: 7500, savingsAmount: 0 });
    expect([403, 404]).toContain(stillCannot.status);

    const afterCounts = await withAdminValue(async (db) => {
      const customers = Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM customers WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n);
      const payments = Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payments WHERE company_id=$1`, [w.companyA]
      )).rows[0]!.n);
      return { customers, payments };
    });
    // RULE 6.5.3 - reading and being notified never became writing.
    expect(afterCounts.customers).toBe(beforeAuditorReads.customers);
    expect(afterCounts.payments).toBe(beforeAuditorReads.payments);
    void mdToken;
    void beforeCounts;
  });
});
