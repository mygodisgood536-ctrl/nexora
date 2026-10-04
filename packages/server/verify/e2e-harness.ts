/**
 * INDEPENDENT end-to-end verification harness (takeover agent).
 *
 * This deliberately does NOT reuse the project's own test helpers for the
 * journey it walks. It drives the real Express app over real HTTP with a real
 * PostgreSQL database, as the real users named in the Vision v3.9 authority:
 *
 *   Platform Owner -> create company -> company URL -> fresh MD credential
 *   -> MD ritual (password, authenticator, profile) -> MD Board reachable
 *   -> MD creates HR/Finance/Auditor -> branch -> branch workers
 *   -> branch worker logs in at the BRANCH URL (not the Branch Workplace)
 *   -> C.O. registers customer -> loan -> approval -> disbursement
 *   -> virtual account appears only at disbursement -> customer portal
 *   -> webhook payment -> allocation -> ledger/performance
 *   -> isolation + permission boundaries
 *
 * Every assertion checks the DATABASE as well as the HTTP response, and every
 * "must be prevented" case asserts the refusal rather than the success.
 */
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://nexora:nexora@localhost:5432/nexora_test";

const ADMIN_URL = "postgres://postgres:nexora-dev@localhost:5432/nexora_test";

const results: { name: string; ok: boolean; detail: string }[] = [];
let currentPhase = "";

function log(...a: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...a);
}

function record(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"}  [${currentPhase}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function check(name: string, ok: boolean, detail = ""): void {
  record(name, ok, detail);
}

async function admin(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  return c;
}

/** RFC 6238 TOTP so a real live code can be produced for the real verifier. */
function totp(secret: string): string {
  const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of secret.replace(/=+$/g, "")) {
    const idx = b32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const off = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[off]! & 0x7f) << 24) | (hmac[off + 1]! << 16) | (hmac[off + 2]! << 8) | hmac[off + 3]!;
  return String(code % 1000000).padStart(6, "0");
}

export { log, record, check, admin, totp, results };

/** Minimal real HTTP client against the real app instance. */
export function client(app: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("supertest")(app);
}

export function writeReport(file: string): void {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const lines = [
    "=== INDEPENDENT E2E VERIFICATION ===",
    `total: ${results.length}  passed: ${passed}  failed: ${failed.length}`,
    "",
    ...results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` :: ${r.detail}` : ""}`),
  ];
  fs.writeFileSync(file, lines.join("\n"));
  log("");
  log(`TOTAL ${results.length}  PASSED ${passed}  FAILED ${failed.length}`);
  for (const f of failed) log(`  FAILED: ${f.name} :: ${f.detail}`);
}

export function setPhase(p: string): void {
  currentPhase = p;
  log("");
  log(`================ ${p} ================`);
}
