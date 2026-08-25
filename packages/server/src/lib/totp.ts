import crypto from "node:crypto";

/**
 * Minimal RFC 6238 TOTP (SHA-1, 6 digits, 30s step, ±1 step skew) built on
 * node:crypto — the Platform Owner's mandated second factor (PO Spec §1/§40).
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secretBuf: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]!) << 16) |
    ((hmac[offset + 2]!) << 8) |
    hmac[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

export function totpNow(secretBase32: string, at: Date = new Date()): string {
  return hotp(base32Decode(secretBase32), Math.floor(at.getTime() / 30_000));
}

export function verifyTotp(secretBase32: string, code: string, at: Date = new Date()): boolean {
  const normalized = (code ?? "").replace(/\D/g, "");
  if (normalized.length !== 6) return false;
  const counter = Math.floor(at.getTime() / 30_000);
  const secret = base32Decode(secretBase32);
  for (const drift of [-1, 0, 1]) {
    if (hotp(secret, counter + drift) === normalized) return true;
  }
  return false;
}

export function otpauthUri(email: string, secretBase32: string): string {
  return `otpauth://totp/Nexora:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=Nexora&algorithm=SHA1&digits=6&period=30`;
}
