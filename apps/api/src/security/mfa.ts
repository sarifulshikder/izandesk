/** TOTP enrollment helpers shared by login, MFA verification, and step-up. */
import bcrypt = require('bcrypt');
import { pool } from '../db';
import { getCached } from '../integrations/settings';
import { decryptSecret } from './secret-store';
import { verifyTotp } from './totp';

export type MfaRecord = {
  user_id: string;
  secret_enc: string;
  enabled: boolean;
  recovery_hashes: string[];
  enrolled_at: string;
  verified_at: string | null;
  disabled_at: string | null;
};

export async function getMfaRecord(userId: string): Promise<MfaRecord | null> {
  try {
    const r = await pool.query('SELECT * FROM user_mfa WHERE user_id=$1', [userId]);
    return r.rows[0] || null;
  } catch { return null; }
}

export async function mfaEnabled(userId: string): Promise<boolean> {
  const record = await getMfaRecord(userId);
  return !!(record?.enabled && !record.disabled_at);
}

export async function mfaRequiredFor(role: string): Promise<boolean> {
  const all = await getCached('security.require_2fa', false);
  const adminOnly = await getCached('security.require_mfa_super_admin', false);
  return !!all || (role === 'SUPER_ADMIN' && !!adminOnly);
}

export async function consumeMfaCode(userId: string, code: string): Promise<{ ok: boolean; method: 'totp' | 'recovery' | null; error?: string }> {
  const record = await getMfaRecord(userId);
  if (!record?.enabled || record.disabled_at) return { ok: false, method: null, error: 'MFA is not enabled for this account.' };
  const value = String(code || '').trim();
  if (!value) return { ok: false, method: null, error: 'Verification code is required.' };

  try {
    if (verifyTotp(decryptSecret(record.secret_enc), value)) return { ok: true, method: 'totp' };
  } catch {}

  const hashes = Array.isArray(record.recovery_hashes) ? record.recovery_hashes : [];
  for (const hash of hashes) {
    try {
      if (await bcrypt.compare(value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(), hash)) {
        const remaining = hashes.filter((h) => h !== hash);
        await pool.query('UPDATE user_mfa SET recovery_hashes=$2::jsonb WHERE user_id=$1', [userId, JSON.stringify(remaining)]);
        return { ok: true, method: 'recovery' };
      }
    } catch {}
  }
  return { ok: false, method: null, error: 'Invalid or expired verification code.' };
}
