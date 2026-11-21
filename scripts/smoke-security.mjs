/**
 * Dependency-free smoke test for the security primitives. Run after building
 * the API: `pnpm --filter @izandesk/shared-types build && pnpm --filter api build && node scripts/smoke-security.mjs`
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const guards = require('../apps/api/dist/security/guards.js');
const totp = require('../apps/api/dist/security/totp.js');
const store = require('../apps/api/dist/security/secret-store.js');
const limiter = require('../apps/api/dist/security/rate-limit.js');

// 1. Production bootstrap guard.
process.env.NODE_ENV = 'production';
process.env.SECURITY_STRICT_MODE = 'true';
process.env.SECURITY_ALLOW_INSECURE_DEMO = '';
process.env.JWT_SECRET = 'short';
process.env.DB_PASSWORD = 'izandesk_secret_password';
process.env.DISABLE_DEMO_ACCOUNTS = 'false';
process.env.WEB_ORIGIN = '';
process.env.ALLOW_LAN_ORIGINS = 'true';
assert.throws(() => guards.assertProductionSecurity(), /bootstrap checks failed/);

Object.assign(process.env, {
  JWT_SECRET: 'a-very-long-non-default-jwt-secret-for-tests',
  DB_PASSWORD: 'strong-db-password',
  DISABLE_DEMO_ACCOUNTS: 'true',
  WEB_ORIGIN: 'https://izandesk.example.com',
  ALLOW_LAN_ORIGINS: 'false',
});
assert.equal(guards.assertProductionSecurity().warnings.length, 0);
assert.equal(guards.ipAllowed('10.0.0.5', ['10.0.0.0/8']), true);
assert.equal(guards.ipAllowed('192.168.1.4', ['10.0.0.0/8']), false);

// 2. TOTP matches an independently computed RFC 6238 code.
const secret = totp.generateTotpSecret();
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let bits = 0;
let value = 0;
const bytes = [];
for (const char of secret) {
  value = (value << 5) | alphabet.indexOf(char);
  bits += 5;
  if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
}
const counter = Buffer.alloc(8);
counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
const digest = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
const offset = digest[digest.length - 1] & 0x0f;
const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
assert.equal(totp.verifyTotp(secret, code), true);
assert.equal(totp.verifyTotp(secret, code, 0), true);
assert.equal(totp.verifyTotp(secret, '000000'), false);
assert.match(totp.otpauthUri(secret, 'admin@example.com'), /^otpauth:\/\/totp\//);
assert.equal(totp.generateRecoveryCodes(3).length, 3);

// 3. Secret encryption roundtrip and tamper detection.
const encrypted = store.encryptSecret(secret);
assert.notEqual(encrypted, secret);
assert.equal(store.decryptSecret(encrypted), secret);
assert.throws(() => store.decryptSecret(encrypted.slice(0, -4) + 'AAAA'));

// 4. Rate limiter.
const rl = limiter.createRateLimiter('smoke', 2, 60_000);
assert.equal(rl.check('ip-1').allowed, true);
assert.equal(rl.check('ip-1').allowed, true);
assert.equal(rl.check('ip-1').allowed, false);
assert.equal(rl.check('ip-2').allowed, true);

console.log('security smoke: guards, TOTP, secret encryption, rate limiter OK');
