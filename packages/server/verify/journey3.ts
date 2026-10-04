/**
 * INDEPENDENT DEEP JOURNEY PART 3 - operational + isolation workflows, run
 * against the company/branch/roles that journey2 really created.
 *
 *   C.O. registers customers (RULE 9.2); no VA may exist yet (prohibition 12)
 *   FIVE groups of FIVE members created, then verified in the DATABASE
 *   provider added; webhook before connection test is refused (prohibition 19)
 *   wrongly-signed webhook is refused
 *   foreign-company ids refused on 7 surfaces with no leak
 *   a C.O. cannot write into another branch or reach the accounting journal
 *   Finance CAN reach the journal; the Auditor CAN read customers
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://nexora:nexora@localhost:5432/nexora_test";

import request from "supertest";
import type { Express } from "express";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { log, check, admin, writeReport, setPhase } from "./e2e-harness";

const SECRET = "journey-deep-signing-secret-0123456789";
let state: any;
let refSeq = 0;
const nextRef = () => `J3-${Date.now().toString(36)}-${refSeq++}`;

function postWebhook(app: Express, payload: unknown, secret: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(payload);
  return request(app)
    .post("/api/v1/webhooks/payments/sandbox")
    .set("X-Nexora-Company", state.slug)
    .set("X-Nexora-Timestamp", ts)
    .set("X-Nexora-Signature", createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex"))
    .set("Content-Type", "application/json")
    .send(body);
}

async function main(): Promise<void> {
  state = JSON.parse(fs.readFileSync("../../_probe_out/journey2-state.json", "utf8"));
  const db = await admin();
  const { createApp } = await import("../src/app");
  const app: Express = createApp();
  const coTok = state.actors.collection_officer.token;
  const coHost = state.branchHost;

  setPhase("F. C.O. registers customers; no virtual account may exist yet");
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await request(app)
      .post("/api/v1/customers")
      .set("Host", coHost)
      .set("Authorization", `Bearer ${coTok}`)
      .send({
        branchId: state.branchId,
        firstName: `Journey${i}`,
        lastName: `Customer${i}`,
        phone: `+23480066${10000 + i}`,
        address: `${i + 1} Market Road, Ikirun`
      });
    if (r.status === 201) ids.push(r.body.id ?? r.body.customer?.id);
    else check(`register customer ${i}`, false, `status=${r.status} ${JSON.stringify(r.body).slice(0, 130)}`);
  }
  check("C.O. registers 5 customers", ids.length === 5, `created=${ids.length}`);
  if (ids.length === 5) {
    const va = await db.query<{ n: string }>(
      `SELECT count(*)::text n FROM virtual_accounts WHERE customer_id = ANY($1::uuid[])`,
      [ids]
    );
    check("NO virtual account at registration (prohibition 12)", va.rows[0]!.n === "0", `vas=${va.rows[0]!.n}`);
  }

  setPhase("G. Five groups of five members (RULE 9.3)");
  const gids: string[] = [];
  // Short run tag keeps group names unique per invocation (see the constraint note below).
  const runTag = Date.now().toString(36).slice(-5);
  for (let g = 0; g < 5; g++) {
    const gr = await request(app)
      .post("/api/v1/groups")
      .set("Host", coHost)
      .set("Authorization", `Bearer ${coTok}`)
      .send({
        branchId: state.branchId,
        // Run-scoped names: journeys reuse one seeded company and the database
        // persists between runs, so fixed names collide on
        // groups_company_id_branch_id_name_key.
        name: `Journey Group ${runTag} ${g}`,
        groupNumber: `GRP-${runTag}-${g}`,
        groupAddress: `${g + 1} Igbara Road`,
        dateCreated: "2026-01-15"
      });
    if (gr.status !== 201) {
      check(`create group ${g}`, false, `status=${gr.status} ${JSON.stringify(gr.body).slice(0, 130)}`);
      continue;
    }
    const gid = gr.body.id ?? gr.body.group?.id;
    gids.push(gid);
    for (const cid of ids) {
      const m = await request(app)
        .post(`/api/v1/groups/${gid}/members`)
        .set("Host", coHost)
        .set("Authorization", `Bearer ${coTok}`)
        .send({
          customerId: cid,
          fullName: `Journey Member ${ids.indexOf(cid)}`,
          fatherHusbandName: `Journey Father ${ids.indexOf(cid)}`,
          maritalStatus: "Single",
          phone: `+23480077${10000 + ids.indexOf(cid)}`,
          groupRole: "Member"
        });
      if (m.status !== 201) {
        check(`member -> group ${g}`, false, `status=${m.status} ${JSON.stringify(m.body).slice(0, 110)}`);
        break;
      }
    }
  }
  check("5 groups created", gids.length === 5, `groups=${gids.length}`);

  const counts: number[] = [];
  for (const gid of gids) {
    const m = await request(app)
      .get(`/api/v1/groups/${gid}/members`)
      .set("Host", coHost)
      .set("Authorization", `Bearer ${coTok}`);
    const arr = m.body?.members ?? m.body?.items ?? [];
    counts.push(Array.isArray(arr) ? arr.length : -1);
  }
  check("Every group holds exactly 5 members", counts.length === 5 && counts.every((n) => n === 5), `counts=${counts.join(",")}`);

  if (gids.length === 5) {
    const dbm = await db.query<{ n: string }>(
      `SELECT count(*)::text n FROM group_members WHERE group_id = ANY($1::uuid[])`,
      [gids]
    );
    check("Database agrees: 25 group_member rows persisted", dbm.rows[0]?.n === "25", `rows=${dbm.rows[0]?.n}`);
  }
  setPhase("H. Provider gating and webhook signature (RULE 8.4 / prohibition 19)");
  const pc = await request(app)
    .post("/api/v1/payment-providers")
    .set("Host", state.companyHost)
    .set("Authorization", `Bearer ${state.md.token}`)
    .send({
      branchId: state.branchId,
      provider: "sandbox",
      apiBaseUrl: "https://sandbox.example.test/",
      apiKey: "api-key-00000000",
      signingSecret: SECRET
    });
  check("MD adds the branch provider", pc.status === 201 || pc.status === 200, `status=${pc.status} ${JSON.stringify(pc.body).slice(0, 140)}`);

  const before = await postWebhook(app, {
    event: "payment.received",
    transaction: { reference: nextRef(), account_number: "1000000001", amount: 1000 }
  }, SECRET);
  check("Webhook before connection test is refused (prohibition 19)", before.status !== 200, `status=${before.status}`);

  const wrong = await postWebhook(app, {
    event: "payment.received",
    transaction: { reference: nextRef(), account_number: "1000000001", amount: 1000 }
  }, "a-completely-wrong-signing-secret");
  check("Webhook with a WRONG signature is refused", wrong.status !== 200, `status=${wrong.status}`);

  setPhase("I. Cross-company, cross-branch and role boundaries");
  const other = await db.query<{ id: string }>(`SELECT id FROM companies WHERE id <> $1 LIMIT 1`, [state.companyId]);
  const foreign = other.rows[0]?.id ?? "00000000-0000-0000-0000-000000000000";
  const surfaces: [string, string][] = [
    ["customers", "/api/v1/customers"],
    ["groups", "/api/v1/groups"],
    ["workers", "/api/v1/workers"],
    ["payments", "/api/v1/payments"],
    ["branches", "/api/v1/branches"],
    ["audit", "/api/v1/audit"],
    ["notifications", "/api/v1/notifications"]
  ];
  for (const [name, base] of surfaces) {
    const r = await request(app)
      .get(`${base}/${foreign}`)
      .set("Host", coHost)
      .set("Authorization", `Bearer ${coTok}`);
    check(`foreign ${name} id refused`, r.status === 403 || r.status === 404, `status=${r.status}`);
  }

  const cross = await request(app)
    .post("/api/v1/customers")
    .set("Host", coHost)
    .set("Authorization", `Bearer ${coTok}`)
    .send({ branchId: foreign, firstName: "Sneaky", lastName: "Cross", address: "9 Elsewhere Road" });
  check("C.O. cannot write into another branch", cross.status >= 400, `status=${cross.status}`);

  const coJ = await request(app).get("/api/v1/accounting/ledger").set("Host", coHost).set("Authorization", `Bearer ${coTok}`);
  check("C.O. cannot reach the accounting ledger", coJ.status === 403, `status=${coJ.status}`);
  const finJ = await request(app).get("/api/v1/accounting/ledger").set("Host", state.companyHost).set("Authorization", `Bearer ${state.actors.finance_manager.token}`);
  check("Finance Manager CAN reach the accounting ledger", finJ.status === 200, `status=${finJ.status}`);
  const audC = await request(app).get("/api/v1/customers").set("Host", state.companyHost).set("Authorization", `Bearer ${state.actors.internal_auditor.token}`);
  check("Auditor CAN read customers (RULE 6.5.1)", audC.status === 200, `status=${audC.status}`);

  fs.writeFileSync("../../_probe_out/journey3-state.json", JSON.stringify({ customerIds: ids, groupIds: gids }, null, 2));
  log("");
  log(`saved: customers=${ids.length} groups=${gids.length}`);
  await db.end().catch(() => undefined);
}

void (async () => {
  try { await main(); } catch (e) { console.error("HARNESS ERROR:", e); }
  writeReport("../../_probe_out/independent-e2e-ops.txt");
  process.exit(0);
})();