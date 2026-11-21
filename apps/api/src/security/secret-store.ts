/** AES-256-GCM at-rest encryption for TOTP seeds and other small secrets. */
import crypto = require('crypto');

function key(): Buffer {
  const secret = String(process.env.JWT_SECRET || 'izandesk-dev-secret-change-me');
  return crypto.createHash('sha256').update(`izandesk:secrets:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivRaw, tagRaw, dataRaw] = String(payload || '').split('.');
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error('Invalid encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8');
}
