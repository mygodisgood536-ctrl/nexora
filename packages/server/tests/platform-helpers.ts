import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { withAdmin } from "./fixtures";

export const PO_EMAIL = "owner@nexora.test";
export const PO_PASSWORD = "OwnerPassword!123";
let totpSecret = "";

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

/** Unique letters-only prefix per run so re-runs against the same DB stay valid. */
export function randomPrefix(): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += A[Math.floor(Math.random() * A.length)];
  return "ZQ" + suffix;
}
