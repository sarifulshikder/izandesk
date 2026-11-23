/**
 * AES-256-GCM at-rest encryption for KYC document files.
 *
 * Keys are versioned so an operator can rotate without invalidating old files:
 *   KYC_ENCRYPTION_KEYS=v1:<base64-32-bytes>,v2:<base64-32-bytes>
 *   KYC_ENCRYPTION_ACTIVE_KEY_ID=v2
 * Previous key ids should stay in KYC_ENCRYPTION_KEYS until the daily
 * maintenance sweep has re-encrypted every document under the active key.
 *
 * When no explicit key is configured, a demo key is derived from JWT_SECRET so
 * local development works without extra setup. Strict/production mode warns
 * (and fails bootstrap) until a dedicated KYC key is supplied.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');

export const KYC_FILE_ALGORITHM = 'aes-256-gcm';

export interface KycEncryptionMeta {
  algorithm: string;
  iv: string;
  authTag: string;
  keyId: string;
}

export interface EncryptedKycFile extends KycEncryptionMeta {
  filePath: string;
}

type KycKey = { id: string; key: Buffer };
type EncryptedPayload = KycEncryptionMeta & { ciphertext: Buffer };

function derivedDemoKey(): Buffer {
  const secret = String(process.env.JWT_SECRET || 'izandesk-dev-secret-change-me');
  return crypto.createHash('sha256').update(`izandesk:kyc-files:${secret}`).digest();
}

function parseKeys(): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  const raw = String(process.env.KYC_ENCRYPTION_KEYS || '').trim();
  if (raw) {
    for (const entry of raw.split(',')) {
      const separator = entry.indexOf(':');
      if (separator < 1) continue;
      const id = entry.slice(0, separator).trim();
      const encoded = entry.slice(separator + 1).trim();
      if (!id || !encoded) continue;
      const key = Buffer.from(encoded, 'base64');
      if (key.length === 32) keys.set(id, key);
    }
  }
  if (!keys.size) keys.set(String(process.env.KYC_ENCRYPTION_ACTIVE_KEY_ID || '').trim() || 'v1', derivedDemoKey());
  return keys;
}

export function isKycEncryptionKeyConfigured(): boolean {
  const raw = String(process.env.KYC_ENCRYPTION_KEYS || '').trim();
  if (!raw) return false;
  return raw.split(',').some((entry) => {
    const separator = entry.indexOf(':');
    if (separator < 1) return false;
    const encoded = entry.slice(separator + 1).trim();
    return !!entry.slice(0, separator).trim() && Buffer.from(encoded, 'base64').length === 32;
  });
}

export function isKycActiveKeyConfigured(): boolean {
  const raw = String(process.env.KYC_ENCRYPTION_KEYS || '').trim();
  if (!raw) return true; // demo fallback always creates the requested id
  const activeId = String(process.env.KYC_ENCRYPTION_ACTIVE_KEY_ID || '').trim();
  const ids = raw.split(',').map((entry) => entry.slice(0, entry.indexOf(':')).trim()).filter(Boolean);
  return activeId ? ids.includes(activeId) : ids.length > 0;
}

export function activeKycKey(): KycKey {
  const keys = parseKeys();
  const configuredId = String(process.env.KYC_ENCRYPTION_ACTIVE_KEY_ID || '').trim();
  const id = configuredId || (keys.keys().next().value as string | undefined) || 'v1';
  const key = keys.get(id);
  if (!key) throw new Error(`KYC encryption key '${id}' is not configured`);
  return { id, key };
}

function keyFor(id: string): Buffer {
  const key = parseKeys().get(String(id || ''));
  if (!key) throw new Error(`KYC encryption key '${id}' is not available for decryption`);
  return key;
}

function encryptBuffer(plain: Buffer): EncryptedPayload {
  const { id, key } = activeKycKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(KYC_FILE_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    algorithm: KYC_FILE_ALGORITHM,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyId: id,
    ciphertext,
  };
}

function writeEncrypted(payload: EncryptedPayload, destinationDir: string): EncryptedKycFile {
  const filePath = path.join(destinationDir, `${crypto.randomUUID()}.enc`);
  fs.writeFileSync(filePath, payload.ciphertext, { mode: 0o600 });
  const { ciphertext: _ciphertext, ...meta } = payload;
  void _ciphertext;
  return { filePath, ...meta };
}

/**
 * Encrypt an uploaded file. Prefer `encryptKycBuffer` for new uploads so the
 * plaintext is never written to the document store at all.
 */
export function encryptKycFile(sourcePath: string, destinationDir = path.dirname(sourcePath)): EncryptedKycFile {
  return writeEncrypted(encryptBuffer(fs.readFileSync(sourcePath)), destinationDir);
}

/** Encrypt in-memory upload bytes straight to a 0600 ciphertext file. */
export function encryptKycBuffer(plain: Buffer, destinationDir: string): EncryptedKycFile {
  return writeEncrypted(encryptBuffer(plain), destinationDir);
}

/** Decrypt a stored file. Returns raw bytes for legacy plaintext documents. */
export function decryptKycFile(filePath: string, meta: KycEncryptionMeta | null): Buffer {
  const stored = fs.readFileSync(filePath);
  if (!meta?.algorithm) return stored;
  if (meta.algorithm !== KYC_FILE_ALGORITHM) throw new Error(`Unsupported KYC file encryption algorithm: ${meta.algorithm}`);
  const decipher = crypto.createDecipheriv(KYC_FILE_ALGORITHM, keyFor(meta.keyId), Buffer.from(meta.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(meta.authTag, 'base64'));
  return Buffer.concat([decipher.update(stored), decipher.final()]);
}

/**
 * Re-encrypt a stored file under the active key. Returns null when the file is
 * already current. Used by the maintenance sweep for migration and rotation.
 */
export function reencryptKycFile(filePath: string, meta: KycEncryptionMeta | null): (EncryptedKycFile & { previousPath: string }) | null {
  const active = activeKycKey();
  if (meta?.algorithm === KYC_FILE_ALGORITHM && meta.keyId === active.id) return null;
  const plain = decryptKycFile(filePath, meta);
  const next = writeEncrypted(encryptBuffer(plain), path.dirname(filePath));
  return { ...next, previousPath: filePath };
}

/** Remove a stored file after overwriting it. Overwrite is best effort on SSD/journaling filesystems. */
export function secureUnlinkKycFile(filePath: unknown): void {
  const target = String(filePath || '');
  if (!target) return;
  try {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isFile() && stat.size > 0) {
      const fd = fs.openSync(target, 'r+');
      try {
        let offset = 0;
        while (offset < stat.size) {
          const chunk = crypto.randomBytes(Math.min(1024 * 1024, stat.size - offset));
          fs.writeSync(fd, chunk, 0, chunk.length, offset);
          offset += chunk.length;
        }
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch { /* best effort: ciphertext without the key is not plaintext */ }
  try { fs.unlinkSync(target); } catch { /* best effort */ }
}

export function unlinkIfExists(filePath: unknown): void {
  const target = String(filePath || '');
  if (!target) return;
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch { /* best effort */ }
}
