// Stage 7D - Reconciliation exception lifecycle (Part 1 §21 / Part 2 §39).
// The reconciliation diff produces open items in a persistent, resolvable
// queue. Finance can resolve or dismiss each item (never delete it) and
// every transition is audited. Items are tenant-scoped: another company can
// never see or act on them.
import { describe, expect, it } from "vitest";
import request from "supertest";
import { seedWorld, withAdmin } from "./fixtures";
import { staffLogin } from "./platform-helpers";

const ALPHA_HOST = "alpha-test.localhost";
const BETA_HOST = "beta-test.localhost";

let runCounter = 0;
function nextRef(prefix: string): string {
  const code = `${Date.now().toString(36)}${runCounter++}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${code}`;
}

async function alphaCompanyId(): Promise<string> {
  let id = "";
  await withAdmin(async (db) => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM companies WHERE slug='alpha-test'`
    );
    id = r.rows[0]!.id;
  });
  return id;
}

async function seedOpenItems(app: import("express").Express, token: string, refs: string[]): Promise<void> {
  for (const ref of refs) {
    const rec = await request(app)
      .post("/api/v1/payments/reconcile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        provider: "sandbox",
        providerTransactions: [
          { providerTxnRef: ref, amount: 12345, valueDate: "2026-01-15T10:00:00Z" }
        ]
      });
    expect(rec.status).toBe(200);
    expect(rec.body.added).toBeGreaterThan(0);
  }
}

async function findItemId(
  app: import("express").Express,
  token: string,
  ref: string
): Promise<string> {
  let id = "";
  await new Promise<void>((done, reject) => {
    const attempt = async () => {
      const list = await request(app)
        .get("/api/v1/reconciliation-items?limit=50")
        .set("Authorization", `Bearer ${token}`);
      const item = list.body.items.find((i: { provider_txn_ref: string }) => i.provider_txn_ref === ref);
      if (item) {
        id = item.id;
        done();
      } else {
        setTimeout(attempt, 200);
      }
    };
    attempt().catch(reject);
  });
  if (!id) throw new Error("reconciliation item not found");
  return id;
}

describe("stage 7D - reconciliation exception lifecycle", () => {
  it("resolves an open exception, recording the actor and reason in audit", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const finToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const ref = nextRef("REC-RESOLVE");
    await seedOpenItems(app, token, [ref]);

    const itemId = await findItemId(app, token, ref);
    const res = await request(app)
      .post(`/api/v1/reconciliation-items/${itemId}/resolve`)
      .set("Authorization", `Bearer ${finToken}`)
      .send({ note: "confirmed pending clarification" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("resolved");

    const companyId = await alphaCompanyId();
    await withAdmin(async (db) => {
      const row = await db.query<{ status: string; resolved_by: string; resolution_note: string }>(
        `SELECT status, resolved_by, resolution_note FROM reconciliation_items WHERE id=$1`,
        [itemId]
      );
      expect(row.rows[0]!.status).toBe("resolved");
      expect(row.rows[0]!.resolution_note).toBe("confirmed pending clarification");
      expect(row.rows[0]!.resolved_by).not.toBeNull();

      const audit = await db.query<{ action: string; entity_id: string }>(
        `SELECT action, entity_id FROM audit_logs
          WHERE company_id=$1 AND entity_type='reconciliation_items'
            AND entity_id=$2 AND action='reconciliation_item.resolved'`,
        [companyId, itemId]
      );
      expect(audit.rowCount).toBe(1);
    });

    const list = await request(app)
      .get("/api/v1/reconciliation-items?status=resolved&limit=50")
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.items.some((i: { id: string }) => i.id === itemId)).toBe(true);
    const openList = await request(app)
      .get("/api/v1/reconciliation-items?status=open&limit=50")
      .set("Authorization", `Bearer ${token}`);
    expect(openList.body.items.some((i: { id: string }) => i.id === itemId)).toBe(false);
  });

  it("dismisses an open exception and refuses to resolve a dismissed one (409)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const finToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const ref = nextRef("REC-DISMISS");
    await seedOpenItems(app, token, [ref]);
    const itemId = await findItemId(app, token, ref);

    const dismissed = await request(app)
      .post(`/api/v1/reconciliation-items/${itemId}/dismiss`)
      .set("Authorization", `Bearer ${finToken}`)
      .send({ note: "benign provider artifact" });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.status).toBe("dismissed");

    const thenResolve = await request(app)
      .post(`/api/v1/reconciliation-items/${itemId}/resolve`)
      .set("Authorization", `Bearer ${finToken}`)
      .send({ note: "late decision" });
    expect(thenResolve.status).toBe(409);
  });

  it("rejects double operations on the same item (409) and 404s unknown ids", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const finToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const ref = nextRef("REC-DOUBLE");
    await seedOpenItems(app, token, [ref]);
    const itemId = await findItemId(app, token, ref);

    const first = await request(app)
      .post(`/api/v1/reconciliation-items/${itemId}/resolve`)
      .set("Authorization", `Bearer ${finToken}`)
      .send({});
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/api/v1/reconciliation-items/${itemId}/resolve`)
      .set("Authorization", `Bearer ${finToken}`)
      .send({});
    expect(second.status).toBe(409);

    const missing = await request(app)
      .post("/api/v1/reconciliation-items/00000000-0000-4000-8000-000000000000/dismiss")
      .set("Authorization", `Bearer ${finToken}`)
      .send({});
    expect(missing.status).toBe(404);
  });

  it("keeps exceptions tenant-scoped: another company cannot act on them", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const finToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const { token: bToken } = await staffLogin(app, BETA_HOST, "bob");
    const ref = nextRef("REC-ISOLATE");
    await seedOpenItems(app, token, [ref]);
    const itemId = await findItemId(app, token, ref);

    const crossResolve = await request(app)
      .post(`/api/v1/reconciliation-items/${itemId}/resolve`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ note: "beta tries" });
    expect(crossResolve.status).toBe(404);

    const crossDismiss = await request(app)
      .post(`/api/v1/reconciliation-items/${itemId}/dismiss`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ note: "beta tries too" });
    expect(crossDismiss.status).toBe(404);

    const crossList = await request(app)
      .get("/api/v1/reconciliation-items?limit=50")
      .set("Authorization", `Bearer ${bToken}`);
    expect(crossList.body.items.some((i: { id: string }) => i.id === itemId)).toBe(false);

    const stillOpen = await request(app)
      .get(`/api/v1/reconciliation-items?status=open&limit=50`)
      .set("Authorization", `Bearer ${token}`);
    expect(stillOpen.body.items.some((i: { id: string }) => i.id === itemId)).toBe(true);
  });

  it("supports filtering the queue by status (open / resolved / dismissed)", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const { token } = await staffLogin(app, ALPHA_HOST, "alice");
    const finToken = (await staffLogin(app, ALPHA_HOST, "amy")).token;
    const openRef = nextRef("REC-OPEN");
    const resolvedRef = nextRef("REC-DONE");
    const dismissedRef = nextRef("REC-SKIP");
    await seedOpenItems(app, token, [openRef, resolvedRef, dismissedRef]);

    const resolvedId = await findItemId(app, token, resolvedRef);
    const dismissedId = await findItemId(app, token, dismissedRef);

    await request(app)
      .post(`/api/v1/reconciliation-items/${resolvedId}/resolve`)
      .set("Authorization", `Bearer ${finToken}`)
      .send({ note: "sorted" });
    await request(app)
      .post(`/api/v1/reconciliation-items/${dismissedId}/dismiss`)
      .set("Authorization", `Bearer ${finToken}`)
      .send({ note: "not ours" });

    const open = await request(app)
      .get("/api/v1/reconciliation-items?status=open&limit=200")
      .set("Authorization", `Bearer ${token}`);
    expect(open.body.items.some((i: { provider_txn_ref: string }) => i.provider_txn_ref === openRef)).toBe(true);
    expect(open.body.items.some((i: { id: string }) => i.id === resolvedId)).toBe(false);
    expect(open.body.items.some((i: { id: string }) => i.id === dismissedId)).toBe(false);

    const resolved = await request(app)
      .get("/api/v1/reconciliation-items?status=resolved&limit=200")
      .set("Authorization", `Bearer ${token}`);
    expect(resolved.body.items.some((i: { id: string }) => i.id === resolvedId)).toBe(true);

    const dismissed = await request(app)
      .get("/api/v1/reconciliation-items?status=dismissed&limit=200")
      .set("Authorization", `Bearer ${token}`);
    expect(dismissed.body.items.some((i: { id: string }) => i.id === dismissedId)).toBe(true);
  });
});