/**
 * AES-256-GCM at-rest encryption for TOTP seeds, router/OLT passwords,
 * SNMP communities, payment gateway credentials, and messaging secrets.
 *
 * Key configuration (independent of JWT_SECRET rotation):
 *   SECRETS_ENCRYPTION_KEYS=v1:<base64-32-bytes>,v2:<base64-32-bytes>
 *   SECRETS_ENCRYPTION_ACTIVE_KEY_ID=v2
 *   (or single SECRETS_ENCRYPTION_KEY=<base64-32-bytes-or-passphrase>)
 *
 * Falls back to KYC_ENCRYPTION_KEYS if configured, or a JWT_SECRET-derived
 * demo key in development so local runs work without extra config.
 */
import crypto = require('crypto');

const ENVELOPE_PREFIX = 'enc:';

function derivedDemoKey(): Buffer {
  const secret = String(process.env.JWT_SECRET || 'izandesk-dev-secret-change-me');
  return crypto.createHash('sha256').update(`izandesk:secrets:${secret}`).digest();
}

function parseKeyRing(raw: string): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  if (!raw) return keys;
  for (const entry of raw.split(',')) {
    const idx = entry.indexOf(':');
    if (idx < 1) continue;
    const id = entry.slice(0, idx).trim();
    const encoded = entry.slice(idx + 1).trim();
    if (!id || !encoded) continue;
    const buf = Buffer.from(encoded, 'base64');
    if (buf.length === 32) keys.set(id, buf);
  }
  return keys;
}

function resolveKeyRing(): { keys: Map<string, Buffer>; activeId: string; configured: boolean } {
  const explicitRing = parseKeyRing(String(process.env.SECRETS_ENCRYPTION_KEYS || '').trim());
  if (explicitRing.size) {
    const active = String(process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID || '').trim()
      || (explicitRing.keys().next().value as string);
    return { keys: explicitRing, activeId: active, configured: true };
  }

  const single = String(process.env.SECRETS_ENCRYPTION_KEY || '').trim();
  if (single) {
    const maybeB64 = Buffer.from(single, 'base64');
    const buf = maybeB64.length === 32
      ? maybeB64
      : crypto.createHash('sha256').update(`izandesk:secrets-key:${single}`).digest();
    const id = String(process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID || 'v1').trim() || 'v1';
    return { keys: new Map([[id, buf]]), activeId: id, configured: true };
  }

  const kycRing = parseKeyRing(String(process.env.KYC_ENCRYPTION_KEYS || '').trim());
  if (kycRing.size) {
    const active = String(process.env.KYC_ENCRYPTION_ACTIVE_KEY_ID || '').trim()
      || (kycRing.keys().next().value as string);
    return { keys: kycRing, activeId: active, configured: true };
  }

  const demoId = String(process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID || 'v1').trim() || 'v1';
  return { keys: new Map([[demoId, derivedDemoKey()]]), activeId: demoId, configured: false };
}

export function isSecretsEncryptionConfigured(): boolean {
  return resolveKeyRing().configured;
}

export function isDedicatedSecretsKeyConfigured(): boolean {
  const ring = parseKeyRing(String(process.env.SECRETS_ENCRYPTION_KEYS || '').trim());
  if (ring.size > 0) return true;
  return String(process.env.SECRETS_ENCRYPTION_KEY || '').trim().length > 0;
}

function legacyKey(): Buffer {
  return derivedDemoKey();
}

export function isEncryptedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

/** Encrypt a secret string into the versioned envelope `enc:<keyId>:<iv>.<tag>.<cipher>`. */
export function encryptSecret(plain: string): string {
  const { keys, activeId } = resolveKeyRing();
  const key = keys.get(activeId) || derivedDemoKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${ENVELOPE_PREFIX}${activeId}:${[iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.')}`;
}

/** Decrypt either `enc:<keyId>:<iv>.<tag>.<cipher>` or legacy `<iv>.<tag>.<cipher>`. */
export function decryptSecret(payload: string): string {
  const raw = String(payload || '');
  if (raw.startsWith(ENVELOPE_PREFIX)) {
    const rest = raw.slice(ENVELOPE_PREFIX.length);
    const colon = rest.indexOf(':');
    if (colon < 1) throw new Error('Invalid encrypted secret envelope');
    const keyId = rest.slice(0, colon);
    const body = rest.slice(colon + 1);
    const [ivRaw, tagRaw, dataRaw] = body.split('.');
    if (!ivRaw || !tagRaw || !dataRaw) throw new Error('Invalid encrypted secret body');
    const { keys } = resolveKeyRing();
    const key = keys.get(keyId);
    if (!key) throw new Error(`Secret encryption key '${keyId}' is unavailable`);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8');
  }

  // Legacy 3-part format (used by early TOTP enrollments)
  const [ivRaw, tagRaw, dataRaw] = raw.split('.');
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error('Invalid encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', legacyKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8');
}

/** Encrypt optional nullable DB secret; preserves null/empty and already-encrypted envelopes. */
export function encryptSecretValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (!s) return null;
  if (isEncryptedSecret(s)) return s;
  return encryptSecret(s);
}

/**
 * Transparently decrypt a stored DB secret. Plaintext legacy rows (not starting
 * with `enc:`) are returned as-is so upgrades and tests remain seamless.
 */
export function decryptSecretValue(stored: string | null | undefined): string {
  if (stored === null || stored === undefined) return '';
  const s = String(stored);
  if (!s) return '';
  if (!isEncryptedSecret(s)) return s;
  try {
    return decryptSecret(s);
  } catch {
    return '';
  }
}

/** Encrypt top-level string fields inside a credentials JSON object. */
export function encryptCredentialsObject(creds: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!creds || typeof creds !== 'object') return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (typeof v === 'string' && v.length > 0) {
      out[k] = isEncryptedSecret(v) ? v : encryptSecret(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Decrypt top-level encrypted values inside a credentials JSON object. */
export function decryptCredentialsObject<T extends Record<string, any>>(creds: T | null | undefined): T {
  if (!creds || typeof creds !== 'object') return {} as T;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(creds)) {
    out[k] = typeof v === 'string' && isEncryptedSecret(v) ? decryptSecretValue(v) : v;
  }
  return out as T;
}
