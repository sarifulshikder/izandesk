/**
 * Secret at-rest maintenance:
 * - idempotent startup backfill that encrypts legacy plaintext secrets, and
 * - online re-encryption under the active key after a SECRETS_ENCRYPTION rotation.
 *
 * Covers network_routers, olts, payment_gateway_configs, messaging_channels,
 * settings, and user_mfa TOTP seeds.
 */
import { pool } from '../db';
import {
  decryptSecret,
  encryptCredentialsObject,
  encryptSecret,
  encryptSecretValue,
  getActiveSecretKeyId,
  isEncryptedSecret,
} from '../security/secret-store';
import { SETTINGS_SCHEMA } from './settings';
import { logger } from '../infra/logger';

export type SecretRotationReport = {
  active_key_id: string;
  dry_run: boolean;
  rotated: Record<string, number>;
  errors: Array<{ table: string; message: string }>;
};

/** Legacy 3-part envelopes were only written for early TOTP enrollments. */
function looksLikeLegacyEnvelope(value: string): boolean {
  return /^[A-Za-z0-9+/=]+(?:\.[A-Za-z0-9+/=]+){2}$/.test(value);
}

/**
 * Decrypt (when needed) and re-encrypt a value under the active key. Values
 * already wrapped under the active key are returned unchanged, so repeated
 * calls are cheap no-ops.
 */
function rotateValue(value: unknown, activeKeyId: string, assumeEncrypted = false): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (!s) return null;
  if (isEncryptedSecret(s)) {
    const keyId = s.slice('enc:'.length).split(':')[0];
    if (keyId === activeKeyId) return s;
    return encryptSecret(decryptSecret(s));
  }
  if (assumeEncrypted && looksLikeLegacyEnvelope(s)) return encryptSecret(decryptSecret(s));
  return encryptSecret(s);
}

function rotateCredentials(creds: unknown, activeKeyId: string): unknown {
  if (!creds || typeof creds !== 'object' || Array.isArray(creds)) return creds;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(creds as Record<string, unknown>)) {
    out[key] = typeof value === 'string' && value.length > 0 ? rotateValue(value, activeKeyId) : value;
  }
  return out;
}

export async function migratePlaintextSecretsToEncrypted(): Promise<{ updated: number }> {
  let updated = 0;

  try {
    const routers = await pool.query('SELECT id, password, radius_secret FROM network_routers');
    for (const r of routers.rows) {
      const needPass = r.password && !isEncryptedSecret(r.password);
      const needRad = r.radius_secret && !isEncryptedSecret(r.radius_secret);
      if (!needPass && !needRad) continue;
      await pool.query(
        'UPDATE network_routers SET password=$2, radius_secret=$3, updated_at=now() WHERE id=$1',
        [
          r.id,
          needPass ? encryptSecretValue(r.password) : r.password,
          needRad ? encryptSecretValue(r.radius_secret) : r.radius_secret,
        ],
      );
      updated += 1;
    }
  } catch { /* ignore */ }

  try {
    const olts = await pool.query('SELECT id, password, snmp_community FROM olts');
    for (const o of olts.rows) {
      const needPass = o.password && !isEncryptedSecret(o.password);
      const needComm = o.snmp_community && !isEncryptedSecret(o.snmp_community);
      if (!needPass && !needComm) continue;
      await pool.query(
        'UPDATE olts SET password=$2, snmp_community=$3, updated_at=now() WHERE id=$1',
        [
          o.id,
          needPass ? encryptSecretValue(o.password) : o.password,
          needComm ? encryptSecretValue(o.snmp_community) : o.snmp_community,
        ],
      );
      updated += 1;
    }
  } catch { /* ignore */ }

  try {
    const gws = await pool.query('SELECT gateway, credentials, webhook_secret FROM payment_gateway_configs');
    for (const g of gws.rows) {
      const creds = g.credentials && typeof g.credentials === 'object' ? g.credentials : {};
      const hasPlainCred = Object.values(creds).some((v) => typeof v === 'string' && v.length > 0 && !isEncryptedSecret(v));
      const needHook = g.webhook_secret && !isEncryptedSecret(g.webhook_secret);
      if (!hasPlainCred && !needHook) continue;
      await pool.query(
        'UPDATE payment_gateway_configs SET credentials=$2::jsonb, webhook_secret=$3, updated_at=now() WHERE gateway=$1',
        [
          g.gateway,
          JSON.stringify(hasPlainCred ? (encryptCredentialsObject(creds) || {}) : creds),
          needHook ? encryptSecretValue(g.webhook_secret) : g.webhook_secret,
        ],
      );
      updated += 1;
    }
  } catch { /* ignore */ }

  try {
    const chs = await pool.query('SELECT id, credentials, webhook_secret FROM messaging_channels');
    for (const c of chs.rows) {
      const creds = c.credentials && typeof c.credentials === 'object' ? c.credentials : {};
      const hasPlainCred = Object.values(creds).some((v) => typeof v === 'string' && v.length > 0 && !isEncryptedSecret(v));
      const needHook = c.webhook_secret && !isEncryptedSecret(c.webhook_secret);
      if (!hasPlainCred && !needHook) continue;
      await pool.query(
        'UPDATE messaging_channels SET credentials=$2::jsonb, webhook_secret=$3, updated_at=now() WHERE id=$1',
        [
          c.id,
          JSON.stringify(hasPlainCred ? (encryptCredentialsObject(creds) || {}) : creds),
          needHook ? encryptSecretValue(c.webhook_secret) : c.webhook_secret,
        ],
      );
      updated += 1;
    }
  } catch { /* ignore */ }

  try {
    const secretKeys = SETTINGS_SCHEMA.filter((d) => d.secret && !d.hidden).map((d) => d.key);
    if (secretKeys.length) {
      const rows = await pool.query('SELECT key, value FROM settings WHERE key = ANY($1::text[])', [secretKeys]);
      for (const row of rows.rows) {
        if (typeof row.value === 'string' && row.value.length > 0 && !isEncryptedSecret(row.value)) {
          const enc = encryptSecretValue(row.value);
          if (enc) {
            await pool.query('UPDATE settings SET value=$2::jsonb, updated_at=now() WHERE key=$1', [row.key, JSON.stringify(enc)]);
            updated += 1;
          }
        }
      }
    }
  } catch { /* ignore */ }

  if (updated > 0) {
    logger.info({ updated }, '[Secrets] encrypted legacy plaintext secret records');
  }
  return { updated };
}

/**
 * Re-encrypt every stored secret under the active SECRETS_ENCRYPTION key.
 *
 * This is the online half of a key rotation: add the new key id to
 * SECRETS_ENCRYPTION_KEYS, point SECRETS_ENCRYPTION_ACTIVE_KEY_ID at it, then
 * call this routine. Old keys must remain configured until every row has been
 * rotated, otherwise decryption fails and the row is reported in `errors`.
 *
 * KYC document files are handled separately by `migrateKycFileEncryption`
 * because they use their own KYC_ENCRYPTION_* key ring.
 */
export async function rotateStoredSecrets(options: { dryRun?: boolean } = {}): Promise<SecretRotationReport> {
  const dryRun = !!options.dryRun;
  const activeKeyId = getActiveSecretKeyId();
  const rotated: Record<string, number> = {};
  const errors: Array<{ table: string; message: string }> = [];
  const bump = (table: string) => { rotated[table] = (rotated[table] || 0) + 1; };
  const fail = (table: string, id: unknown, err: unknown) => {
    errors.push({ table, message: `${id ?? 'row'}: ${String((err as any)?.message || err).slice(0, 300)}` });
  };

  try {
    const routers = await pool.query('SELECT id, password, radius_secret FROM network_routers');
    for (const r of routers.rows) {
      try {
        const password = r.password ? rotateValue(r.password, activeKeyId) : r.password;
        const radiusSecret = r.radius_secret ? rotateValue(r.radius_secret, activeKeyId) : r.radius_secret;
        if (password === r.password && radiusSecret === r.radius_secret) continue;
        if (!dryRun) {
          await pool.query(
            'UPDATE network_routers SET password=$2, radius_secret=$3, updated_at=now() WHERE id=$1',
            [r.id, password, radiusSecret],
          );
        }
        bump('network_routers');
      } catch (e) { fail('network_routers', r.id, e); }
    }
  } catch (e) { fail('network_routers', 'select', e); }

  try {
    const olts = await pool.query('SELECT id, password, snmp_community FROM olts');
    for (const o of olts.rows) {
      try {
        const password = o.password ? rotateValue(o.password, activeKeyId) : o.password;
        const community = o.snmp_community ? rotateValue(o.snmp_community, activeKeyId) : o.snmp_community;
        if (password === o.password && community === o.snmp_community) continue;
        if (!dryRun) {
          await pool.query(
            'UPDATE olts SET password=$2, snmp_community=$3, updated_at=now() WHERE id=$1',
            [o.id, password, community],
          );
        }
        bump('olts');
      } catch (e) { fail('olts', o.id, e); }
    }
  } catch (e) { fail('olts', 'select', e); }

  try {
    const gateways = await pool.query('SELECT gateway, credentials, webhook_secret FROM payment_gateway_configs');
    for (const g of gateways.rows) {
      try {
        const credentials = rotateCredentials(g.credentials, activeKeyId);
        const webhookSecret = g.webhook_secret ? rotateValue(g.webhook_secret, activeKeyId) : g.webhook_secret;
        if (JSON.stringify(credentials) === JSON.stringify(g.credentials) && webhookSecret === g.webhook_secret) continue;
        if (!dryRun) {
          await pool.query(
            'UPDATE payment_gateway_configs SET credentials=$2::jsonb, webhook_secret=$3, updated_at=now() WHERE gateway=$1',
            [g.gateway, JSON.stringify(credentials || {}), webhookSecret],
          );
        }
        bump('payment_gateway_configs');
      } catch (e) { fail('payment_gateway_configs', g.gateway, e); }
    }
  } catch (e) { fail('payment_gateway_configs', 'select', e); }

  try {
    const channels = await pool.query('SELECT id, credentials, webhook_secret FROM messaging_channels');
    for (const c of channels.rows) {
      try {
        const credentials = rotateCredentials(c.credentials, activeKeyId);
        const webhookSecret = c.webhook_secret ? rotateValue(c.webhook_secret, activeKeyId) : c.webhook_secret;
        if (JSON.stringify(credentials) === JSON.stringify(c.credentials) && webhookSecret === c.webhook_secret) continue;
        if (!dryRun) {
          await pool.query(
            'UPDATE messaging_channels SET credentials=$2::jsonb, webhook_secret=$3, updated_at=now() WHERE id=$1',
            [c.id, JSON.stringify(credentials || {}), webhookSecret],
          );
        }
        bump('messaging_channels');
      } catch (e) { fail('messaging_channels', c.id, e); }
    }
  } catch (e) { fail('messaging_channels', 'select', e); }

  try {
    const secretKeys = SETTINGS_SCHEMA.filter((d) => d.secret && !d.hidden).map((d) => d.key);
    if (secretKeys.length) {
      const rows = await pool.query('SELECT key, value FROM settings WHERE key = ANY($1::text[])', [secretKeys]);
      for (const row of rows.rows) {
        try {
          if (typeof row.value !== 'string' || row.value.length === 0) continue;
          const value = rotateValue(row.value, activeKeyId);
          if (value === row.value) continue;
          if (!dryRun) {
            await pool.query('UPDATE settings SET value=$2::jsonb, updated_at=now() WHERE key=$1', [row.key, JSON.stringify(value)]);
          }
          bump('settings');
        } catch (e) { fail('settings', row.key, e); }
      }
    }
  } catch (e) { fail('settings', 'select', e); }

  try {
    const mfa = await pool.query("SELECT user_id, secret_enc FROM user_mfa WHERE secret_enc IS NOT NULL AND secret_enc <> ''");
    for (const row of mfa.rows) {
      try {
        const secret = rotateValue(row.secret_enc, activeKeyId, true);
        if (secret === row.secret_enc) continue;
        if (!dryRun) {
          await pool.query('UPDATE user_mfa SET secret_enc=$2 WHERE user_id=$1', [row.user_id, secret]);
        }
        bump('user_mfa');
      } catch (e) { fail('user_mfa', row.user_id, e); }
    }
  } catch (e) { fail('user_mfa', 'select', e); }

  if (!dryRun && Object.keys(rotated).length > 0) {
    logger.info({ activeKeyId, rotated }, '[Secrets] re-encrypted stored secrets under active key');
  }

  return { active_key_id: activeKeyId, dry_run: dryRun, rotated, errors };
}
