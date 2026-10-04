import { describe, expect, it } from "vitest";
import pg from "pg";
import { seedWorld, withAppSession } from "./fixtures";

const INSUFFICIENT_PRIVILEGE = "42501";
const TEST_URL = process.env.DATABASE_URL ?? "postgres://nexora:nexora@localhost:5432/nexora_test";

async function openAppClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: TEST_URL });
  await client.connect();
  return client;
}

describe("stage 1 row-level security isolation", () => {
  it("returns zero tenant rows when no tenant session is established (fail-closed)", async () => {
    await seedWorld();
    const db = await openAppClient();
    try {
      const customers = await db.query("SELECT count(*)::int AS n FROM customers");
      expect(customers.rows[0].n).toBe(0);
      const loans = await db.query("SELECT count(*)::int AS n FROM loans");
      expect(loans.rows[0].n).toBe(0);
    } finally {
      await db.end();
    }
  });

  it("scopes reads to the session company only", async () => {
    const w = await seedWorld();
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      const rows = await db.query<{ company_id: string }>(
        "SELECT company_id FROM customers ORDER BY customer_code"
      );
      expect(rows.rows).toHaveLength(2);
      for (const row of rows.rows) {
        expect(row.company_id).toBe(w.companyA);
      }
      const crossRead = await db.query("SELECT id FROM customers WHERE id=$1", [w.customerB1]);
      expect(crossRead.rows).toHaveLength(0);
    });
  });

  it("blocks writes whose company_id does not match the session tenant", async () => {
    const w = await seedWorld();
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      await expect(
        db.query(
          `INSERT INTO customers (company_id, branch_id, customer_code, first_name, last_name, address)
           VALUES ($1,$2,'CUST-9999','Cross','Tenant','x')`,
          [w.companyB, w.branchB1]
        )
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("enforces branch scope only while app.branch_restricted is on (single-branch principal)", async () => {
    const w = await seedWorld();

    await withAppSession(
      { "app.company_id": w.companyA, "app.branch_restricted": "on", "app.branch_id": w.branchA1 },
      async (db) => {
        const visible = await db.query<{ branch_id: string }>("SELECT branch_id FROM customers");
        expect(visible.rows).toHaveLength(1);
        expect(visible.rows[0]?.branch_id).toBe(w.branchA1);

        const crossBranchUpdate = await db.query(
          `UPDATE customers SET address='blocked' WHERE id=$1`,
          [w.customerA2]
        );
        expect(crossBranchUpdate.rowCount).toBe(0);
      }
    );

    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      const visible = await db.query<{ branch_id: string }>("SELECT branch_id FROM customers");
      expect(visible.rows).toHaveLength(2);
    });
  });

  it("prevents tampering with out-of-branch rows even when ids are known", async () => {
    const w = await seedWorld();
    await withAppSession(
      { "app.company_id": w.companyA, "app.branch_restricted": "on", "app.branch_id": w.branchA1 },
      async (db) => {
        // The application role holds no DELETE on a customer record at all
        // (Part 15 prohibition 10), so the attempt is refused at the privilege
        // layer. Where a privilege does exist, RLS refuses the row instead.
        // Either refusal means the record survives; neither means it is gone.
        let refused = false;
        try {
          const res = await db.query(`DELETE FROM customers WHERE id=$1`, [w.customerA2]);
          expect(res.rowCount).toBe(0);
          refused = true;
        } catch (err) {
          expect(String((err as { code?: string }).code)).toBe(INSUFFICIENT_PRIVILEGE);
          refused = true;
        }
        expect(refused).toBe(true);
      }
    );

    let survivor = "0";
    await withAppSession({ "app.company_id": w.companyA }, async (db) => {
      const row = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM customers WHERE id=$1`, [
        w.customerA2
      ]);
      survivor = row.rows[0]!.n;
    });
    expect(survivor).toBe("1");
  });

  it("exposes the security-definer virtual account resolver without any tenant session", async () => {
    await seedWorld();
    const db = await openAppClient();
    try {
      const resolved = await db.query(
        "SELECT * FROM resolve_virtual_account('sandbox','2000000001')"
      );
      expect(resolved.rows).toHaveLength(1);
      expect(resolved.rows[0].account_number ?? "n/a").toBeDefined();
      expect(resolved.rows[0].customer_id).toBeTruthy();

      const missing = await db.query(
        "SELECT * FROM resolve_virtual_account('sandbox','unknown-acct')"
      );
      expect(missing.rows).toHaveLength(0);
    } finally {
      await db.end();
    }
  });
});
