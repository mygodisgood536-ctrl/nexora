// Bootstrap the first Platform Owner account.
// Usage: node scripts/bootstrap-platform-owner.mjs <email> <password>
// Prints the TOTP provisioning URI exactly once; the secret is stored
// encrypted-at-rest-light (base32) in platform_owners.totp_secret_encrypted
// and totp_enabled is turned on immediately (PO Spec §1: 2FA is mandatory).
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { generateTotpSecret, otpauthUri } from "../src/lib/totp.js";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 10) {
  console.error("usage: node scripts/bootstrap-platform-owner.mjs <email> <password(>=10 chars)>");
  process.exit(1);
}

const url =
  process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:nexora-dev@localhost:5432/postgres";
const client = new pg.Client({ connectionString: url });
await client.connect();

const existing = await client.query(`SELECT id FROM platform_owners WHERE email=$1`, [email]);
if (existing.rowCount > 0) {
  console.error("platform owner already exists for that email");
  await client.end();
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
const secret = generateTotpSecret();
// Lightweight at-rest wrap so the raw secret is not stored verbatim.
const wrapped = crypto
  .createHash("sha256")
  .update("nexora-totp:" + email)
  .digest()
  .toString("hex");
const encrypted = Buffer.from(secret).toString("base64") + "." + wrapped.slice(0, 16);

await client.query(
  `INSERT INTO platform_owners (email, password_hash, totp_enabled, totp_secret_encrypted)
   VALUES ($1,$2,true,$3)`,
  [email, hash, encrypted]
);
await client.end();

console.log("platform owner created:", email);
console.log("TOTP provisioning URI (scan once, shown only here):");
console.log(otpauthUri(email, secret));
