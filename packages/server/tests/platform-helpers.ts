import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import http from "node:http";
import { expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { withAdmin, withAdminValue } from "./fixtures";

export const PO_EMAIL = "owner@nexora.test";
export const PO_PASSWORD = "OwnerPassword!123";
let totpSecret = "";

/**
 * RULE 9.2.2 — the complete customer profile payload. Disbursement refuses an
 * incomplete profile, so any test that expects a loan to disburse must supply
 * every required group. This is the single source of that payload.
 */
export function completeProfile(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    gender: "female",
    dateOfBirth: "1990-04-12",
    maritalStatus: "single",
    mothersMaidenName: "Adeyemi",
    phone: "+2348000000001",
    email: "customer.test@nexora.test",
    alternativePhone: "+2348000000009",
    address: "1 Market Road",
    businessAddress: "1 Market Road",
    identificationType: "national_id",
    identificationNumber: "ID-TEST-0001",
    bvn: "12345678901",
    occupation: "Trader",
    businessType: "Retail",
    estimatedIncome: 250000,
    nextOfKinName: "Kin Test",
    nextOfKinRelationship: "sibling",
    nextOfKinPhone: "+2348000000002",
    guarantorName: "Guarantor Test",
    guarantorRelationship: "friend",
    guarantorPhone: "+2348000000003",
    guarantorAddress: "2 Backup Road",
    ...overrides
  };
}

export async function attachVerifiedBankDetails(
  actor: { sub: string; companyId: string; branchId: string | null },
  customerId: string,
  applicationId: string
): Promise<void> {
  const identity = await withAdminValue(async (db) => {
    const row = await db.query<{ first_name: string; middle_name: string | null; last_name: string }>(
      `SELECT first_name, middle_name, last_name FROM customers WHERE id=$1`,
      [customerId]
    );
    const value = row.rows[0]!;
    return [value.first_name, value.middle_name, value.last_name].filter(Boolean).join(" ");
  });
  const { saveApplicationBankDetails } = await import("../src/modules/loans/service");
  await saveApplicationBankDetails(actor, {
    applicationId,
    bankName: "Verified Test Bank",
    accountNumber: `019${customerId.replace(/-/g, "").slice(0, 10)}`,
    accountName: identity,
    identityName: identity
  });
}

export async function attachVerifiedFaceEvidence(
  actor: { sub: string; companyId: string; branchId: string | null },
  customerId: string,
  applicationId?: string | null
): Promise<void> {
  const { recordFaceCapture } = await import("../src/modules/face-captures/service");
  const baseBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const bytes = Buffer.concat([baseBytes, Buffer.from(customerId)]);

  let guarantorName: string | null = null;
  if (applicationId) {
    const { saveApplicationGuarantor } = await import("../src/modules/loans/service");
    const guarantor = await saveApplicationGuarantor(actor, {
      applicationId,
      fullName: "Guarantor Test",
      relationship: "friend",
      phone: "+2348000000003",
      address: "2 Backup Road",
      occupation: "Trader",
      houseAddress: "2 Backup Road",
      street: "Backup Street",
      directionToHouse: "Opposite the market",
      localAreaKnownAs: "Backup",
      shopAddress: "4 Trade Road",
      averageDailyIncome: 3000,
      averageMonthlyIncome: 90000
    });
    guarantorName = guarantor.full_name;
  }

  for (const party of ["customer", "guarantor"] as const) {
    await recordFaceCapture(actor, {
      customerId,
      party,
      purpose: "registration",
      bytes,
      mimeType: "image/png",
      liveness: { checked: true, passed: true, provider: "test-fixture", checks: { facePresent: true, brightness: 0.82, clarity: 0.77 } }
    });
    if (applicationId) {
      await recordFaceCapture(actor, {
        customerId,
        party,
        purpose: "loan_application",
        applicationId,
        bytes,
        mimeType: "image/png",
        liveness: { checked: true, passed: true, provider: "test-fixture", checks: { facePresent: true, brightness: 0.82, clarity: 0.77 } }
      });
    }
  }
  if (applicationId) {
    const identity = await withAdminValue(async (db) => {
      const row = await db.query<{ first_name: string; middle_name: string | null; last_name: string }>(
        `SELECT first_name, middle_name, last_name FROM customers WHERE id=$1`,
        [customerId]
      );
      const value = row.rows[0]!;
      return [value.first_name, value.middle_name, value.last_name].filter(Boolean).join(" ");
    });
    const { recordLoanApplicationEvidence } = await import("../src/modules/loan-evidence/service");
    for (const evidenceType of ["government_id", "house", "business", "loan_form", "default_form"] as const) {
      for (const party of ["customer", "guarantor"] as const) {
        await recordLoanApplicationEvidence(actor, {
          applicationId,
          evidenceType,
          party,
          identityName:
            evidenceType === "government_id"
              ? party === "guarantor" ? guarantorName! : identity
              : null,
          bytes: Buffer.concat([baseBytes, Buffer.from(`${customerId}-${evidenceType}-${party}`)]),
          mimeType: "image/png",
          liveness: { checked: true, passed: true, provider: "test-fixture", checks: { facePresent: true, brightness: 0.82, clarity: 0.77 } }
        });
      }
    }
  }
}

/** RULE 19.3 — disbursement requires recorded loan terms, so any test that
 *  expects a loan to disburse must first attach them through the real service. */
export async function attachApplicationTerms(
  actor: { sub: string; companyId: string; branchId: string | null },
  applicationId: string,
  overrides: {
    repaymentMode?: "weekly" | "daily";
    repaymentWeekday?: number | null;
    repaymentPeriods?: number;
    interestPercentage?: number;
  } = {}
): Promise<void> {
  const { saveApplicationTerms } = await import("../src/modules/loans/service");
  const principal = await withAdminValue(async (db) => {
    const row = await db.query<{ principal_amount: string }>(
      `SELECT principal_amount FROM loan_applications WHERE id=$1`,
      [applicationId]
    );
    return Number(row.rows[0]!.principal_amount);
  });
  const interestPercentage = overrides.interestPercentage ?? 5;
  const calculatedInterest = Math.round(principal * (interestPercentage / 100) * 100) / 100;
  const total = principal + calculatedInterest;
  const requested = overrides.repaymentPeriods;
  const candidates = requested ? [requested] : [10, 5, 4, 2, 20, 1];
  let repaymentPeriods = candidates[0]!;
  let repaymentAmount = 0;
  for (const periods of candidates) {
    const amount = Math.round((total / periods) * 100) / 100;
    if (Math.round(amount * periods * 100) === Math.round(total * 100)) {
      repaymentPeriods = periods;
      repaymentAmount = amount;
      break;
    }
  }
  if (repaymentAmount === 0) {
    const amount = Math.round(total * 100) / 100;
    repaymentPeriods = 1;
    repaymentAmount = amount;
  }
  await saveApplicationTerms(actor, {
    applicationId,
    repaymentMode: overrides.repaymentMode ?? "daily",
    repaymentWeekday:
      overrides.repaymentMode === "weekly" ? overrides.repaymentWeekday ?? 3 : null,
    repaymentPeriods,
    interestPercentage,
    repaymentAmount
  });
}

/** Ensures the fixed platform owner exists; returns its base32 TOTP secret. */
export async function ensurePlatformOwner(): Promise<string> {
  let secret = "";
  await withAdmin(async (db) => {
    const existing = await db.query<{ totp_secret_encrypted: string | null }>(
      `SELECT totp_secret_encrypted FROM platform_owners WHERE email=$1`,
      [PO_EMAIL]
    );
    if ((existing.rowCount ?? 0) > 0) {
      secret = Buffer.from(existing.rows[0]!.totp_secret_encrypted!.split(".")[0]!, "base64").toString("utf8");
      return;
    }
    secret = "JBSWY3DPEHPK3PXP"; // fixed base32 test secret
    await db.query(
      `INSERT INTO platform_owners (email, password_hash, totp_enabled, totp_secret_encrypted)
       VALUES ($1,$2,true,$3)`,
      [PO_EMAIL, bcrypt.hashSync(PO_PASSWORD, 8), Buffer.from(secret).toString("base64") + ".testtag"]
    );
  });
  return secret;
}

function totpNow(secret: string): string {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of secret.replace(/=+$/g, "")) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const off = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[off]! & 0x7f) << 24) | ((hmac[off + 1]!) << 16) | ((hmac[off + 2]!) << 8) | hmac[off + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

export async function initPlatformOwner(): Promise<void> {
  totpSecret = await ensurePlatformOwner();
}

export async function poLogin(app: Express): Promise<string> {
  const res = await request(app)
    .post("/platform/v1/auth/login")
    .send({ email: PO_EMAIL, password: PO_PASSWORD, totp: totpNow(totpSecret) });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

/** Staff login against a portal host; returns the access token. */
export async function staffLogin(
  app: Express,
  host: string,
  username: string,
  password: string = "TestPassword!123"
): Promise<{ token: string; mustChangePassword: boolean }> {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username, password });
  expect(res.status).toBe(200);
  return {
    token: res.body.accessToken as string,
    mustChangePassword: res.body.mustChangePassword === true
  };
}

/** Unique uppercase-only prefix per run so re-runs against the same DB stay valid.
 *  Schema constraint is /^[A-Z]{3,6}$/ — ZQ + 4 uppercase chars = 6 chars (max allowed). */
export function randomPrefix(): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += A[Math.floor(Math.random() * A.length)];
  return "ZQ" + suffix;
}

/**
 * Demonstrably activates a payment provider: configures it (as the MD, so the
 * change is authorised by definition) against a real local HTTP endpoint and
 * runs the mandatory connection test (Vision Part 8). Webhooks only ingress
 * for an active, MD-approved config, so suites that post signed webhooks must
 * go through here first. Returns the provider config id.
 */
export async function activateProvider(
  app: Express,
  opts: {
    host: string;
    mdUsername: string;
    branchId: string;
    provider?: string;
    signingSecret: string;
  }
): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const { token } = await staffLogin(app, opts.host, opts.mdUsername);
    const created = await request(app)
      .post("/api/v1/payment-providers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId: opts.branchId,
        provider: opts.provider ?? "sandbox",
        apiBaseUrl: `http://127.0.0.1:${port}/`,
        apiKey: "api-key-00000000",
        signingSecret: opts.signingSecret
      });
    expect([200, 201]).toContain(created.status);
    const id: string = created.body.id;
    const tested = await request(app)
      .post(`/api/v1/payment-providers/${id}/test`)
      .set("Authorization", `Bearer ${token}`);
    expect(tested.status).toBe(200);
    expect(tested.body.ok).toBe(true);
    expect(tested.body.activated).toBe(true);
    return id;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
