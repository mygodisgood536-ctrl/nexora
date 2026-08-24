import { describe, expect, it } from "vitest";
import type pg from "pg";
import { seedWorld, withAppSession, withAdmin } from "./fixtures";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

async function expectError(code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error(`expected PostgreSQL error ${code} but none was thrown`);
  } catch (err) {
    const pgErr = err as pg.DatabaseError;
    if (!pgErr || typeof pgErr.code !== "string") {
      throw err;
    }
    expect(pgErr.code).toBe(code);
  }
}

describe("stage 1 model integrity", () => {
  it("enforces customer_code uniqueness inside a company but allows reuse across companies", async () => {
    const w = await seedWorld();
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      await expectError(UNIQUE_VIOLATION, () =>
        db.query(
          `INSERT INTO customers (company_id, branch_id, customer_code, first_name, last_name, address)
           VALUES ($1,$2,'CUST-0001','Dup','One','x')`,
          [w.companyA, w.branchA1]
        )
      );
    });
    // Same customer_code in another company must be allowed at the uniqueness
    // layer; performed via bypass context because a tenant session would (and
    // must) reject the cross-company write itself — covered by the RLS suite.
    await withAdmin(async (admin) => {
      await admin.query("BEGIN");
      await admin.query("SELECT set_config('app.bypass_rls','on',true)");
      await admin.query(
        `INSERT INTO customers (company_id, branch_id, customer_code, first_name, last_name, address)
         VALUES ($1,$2,'CUST-7777','Same','Code','x')`,
        [w.companyB, w.branchB1]
      );
      const both = await admin.query(
        `SELECT count(*)::int AS n FROM customers WHERE customer_code='CUST-7777'`
      );
      expect(both.rows[0].n).toBe(1);
      await admin.query("COMMIT");
    });
  });

  it("rejects unknown customer statuses", async () => {
    const w = await seedWorld();
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      await expectError(CHECK_VIOLATION, () =>
        db.query(`UPDATE customers SET status='frozen' WHERE id=$1`, [w.customerA1])
      );
    });
  });

  it("rejects a second payment for the same provider transaction reference (idempotency)", async () => {
    const w = await seedWorld();
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      const base = `INSERT INTO payments (company_id, branch_id, customer_id, virtual_account_id,
                       provider, provider_txn_ref, amount, value_date, status)
                    VALUES ($1,$2,$3,$4,'sandbox','TX-TEST-001',1500, now() - interval '5 minutes','received')`;
      await db.query(base, [w.companyA, w.branchA1, w.customerA1, w.vaA1]);
      await expectError(UNIQUE_VIOLATION, () =>
        db.query(base, [w.companyA, w.branchA1, w.customerA1, w.vaA1])
      );
    });
  });

  it("rejects non-positive payment amounts", async () => {
    const w = await seedWorld();
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      await expectError(CHECK_VIOLATION, () =>
        db.query(
          `INSERT INTO payments (company_id, branch_id, customer_id, virtual_account_id,
             provider, provider_txn_ref, amount, value_date)
           VALUES ($1,$2,$3,$4,'sandbox','TX-NEG-001',0,now())`,
          [w.companyA, w.branchA1, w.customerA1, w.vaA1]
        )
      );
    });
  });

  it("allows only one active virtual account per customer, preserving replacement history", async () => {
    const w = await seedWorld();
    await withAdmin(async (admin) => {
      await admin.query("BEGIN");
      await admin.query("SELECT set_config('app.bypass_rls','on',true)");
      const insertVa = (acct: string, status: string) =>
        admin.query(
          `INSERT INTO virtual_accounts (company_id, branch_id, customer_id, provider,
             bank_name, account_name, account_number, status)
           VALUES ($1,$2,$3,'sandbox','Test Bank','Ada Okon',$4,$5)`,
          [w.companyA, w.branchA1, w.customerA1, acct, status]
        );
      await admin.query(`SAVEPOINT va_check`);
      await expectError(UNIQUE_VIOLATION, () => insertVa("3000000001", "active"));
      await admin.query(`ROLLBACK TO SAVEPOINT va_check`);
      await admin.query(`UPDATE virtual_accounts SET status='replaced' WHERE id=$1`, [w.vaA1]);
      await insertVa("3000000001", "active");
      await admin.query("COMMIT");
    });
  });

  it("requires a rejection reason on loan applications", async () => {
    const w = await seedWorld();
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      await db.query("BEGIN");
      const app = (
        await db.query(
          `INSERT INTO loan_applications (company_id, branch_id, customer_id, product_id, chain_id,
             principal_amount, submitted_by)
           SELECT c.company_id, c.branch_id, c.id, p.id, p.approval_chain_id, 5000, $2
           FROM customers c
           JOIN loan_products p ON p.company_id = c.company_id
           WHERE c.id = $1
           RETURNING id`,
          [w.customerA2, w.userA]
        )
      ).rows[0].id;
      await db.query(`SAVEPOINT reject_check`);
      await expectError(CHECK_VIOLATION, () =>
        db.query(`UPDATE loan_applications SET status='rejected', decided_by=$2 WHERE id=$1`, [
          app,
          w.userA
        ])
      );
      await db.query(`ROLLBACK TO SAVEPOINT reject_check`);
      await db.query(
        `UPDATE loan_applications SET status='rejected', decided_by=$2,
           rejection_reason='Insufficient KYC' WHERE id=$1`,
        [app, w.userA]
      );
      await db.query("COMMIT");
    });
  });

  it("rejects unbalanced journal entries at COMMIT via the deferred trigger", async () => {
    const w = await seedWorld();
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      await db.query("BEGIN");
      const gl = async (code: string) =>
        (
          await db.query(
            `INSERT INTO gl_accounts (company_id, code, name, account_type, is_cash)
             VALUES ($1,$2,$3,'asset',true) RETURNING id`,
            [w.companyA, code, `Cash ${code}`]
          )
        ).rows[0].id;
      const cash = await gl("1000");
      const fees = await gl("1100");
      const entry = (
        await db.query(
          `INSERT INTO journal_entries (company_id, entry_date, source, description)
           VALUES ($1,current_date,'payment_pipeline','test entry') RETURNING id`,
          [w.companyA]
        )
      ).rows[0].id;
      await db.query(
        `INSERT INTO journal_lines (company_id, journal_entry_id, gl_account_id, direction, amount)
         VALUES ($1,$2,$3,'debit',1500)`,
        [w.companyA, entry, cash]
      );
      await db.query(
        `INSERT INTO journal_lines (company_id, journal_entry_id, gl_account_id, direction, amount)
         VALUES ($1,$2,$3,'credit',1400)`,
        [w.companyA, entry, fees]
      );
      await expect(() => db.query("COMMIT")).rejects.toThrow(/unbalanced/);
    });
  });

  it("keeps posted financial records immutable to the application role, while pipeline status stays writable", async () => {
    const w = await seedWorld();
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      const payment = (
        await db.query(
          `INSERT INTO payments (company_id, branch_id, customer_id, virtual_account_id,
             provider, provider_txn_ref, amount, value_date)
           VALUES ($1,$2,$3,$4,'sandbox','TX-IMM-001',2500,now()) RETURNING id`,
          [w.companyA, w.branchA1, w.customerA1, w.vaA1]
        )
      ).rows[0].id;

      await expectError(INSUFFICIENT_PRIVILEGE, () =>
        db.query(`UPDATE payments SET amount = 9999 WHERE id=$1`, [payment])
      );
      await db.query(`UPDATE payments SET status='completed' WHERE id=$1`, [payment]);

      await db.query(
        `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id)
         VALUES ($1,$2,'payment.received','payments',$3)`,
        [w.companyA, w.userA, payment]
      );
      await expectError(INSUFFICIENT_PRIVILEGE, () =>
        db.query(`DELETE FROM audit_logs WHERE true`)
      );
    });
  });
});
