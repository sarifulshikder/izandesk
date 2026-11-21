/**
 * Minimal RFC 6238 TOTP implementation. No new dependency is needed: the
 * enrollment secret is stored hashed-at-rest by the auth layer and verified
 * against Google Authenticator / 1Password / Authy compatible otpauth URIs.
 */
import crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = String(input || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx < 0) throw new Error('Invalid TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

function hotp(secret: Buffer, counter: bigint): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(counter, 0);
  const digest = crypto.createHmac('sha1', secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export function verifyTotp(secret: string, token: string, window = 1): boolean {
  const code = String(token || '').replace(/\D/g, '');
  if (code.length !== DIGITS) return false;
  let key: Buffer;
  try { key = base32Decode(secret); } catch { return false; }
  const counter = BigInt(Math.floor(Date.now() / 1000 / STEP_SECONDS));
  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = counter + BigInt(delta);
    if (candidate >= 0n && safeEqual(hotp(key, candidate), code)) return true;
  }
  return false;
}

export function otpauthUri(secret: string, email: string, issuer = 'IzanDesk'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
}
