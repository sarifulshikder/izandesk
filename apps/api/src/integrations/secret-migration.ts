/**
 * Idempotent startup backfill that encrypts legacy plaintext secrets stored
 * in network_routers, olts, payment_gateway_configs, messaging_channels, and settings.
 */
import { pool } from '../db';
import {
  encryptCredentialsObject,
  encryptSecretValue,
  isEncryptedSecret,
} from '../security/secret-store';
import { SETTINGS_SCHEMA } from './settings';
import { logger } from '../infra/logger';

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
