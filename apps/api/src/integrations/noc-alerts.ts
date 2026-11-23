import { pool } from '../db';
import { dispatchMessage } from './messaging';

export type NocAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export async function emitNocAlert(input: {
  severity?: NocAlertSeverity;
  source: string;
  title: string;
  message?: string;
  details?: Record<string, any>;
  dedupeMinutes?: number;
}) {
  const severity = String(input.severity || 'WARNING').toUpperCase();
  const safeSeverity: NocAlertSeverity = severity === 'CRITICAL' || severity === 'INFO' ? (severity as NocAlertSeverity) : 'WARNING';
  const source = String(input.source || 'SYSTEM').slice(0, 64);
  const title = String(input.title || 'Alert').slice(0, 200);
  const dedupeMinutes = Number.isFinite(Number(input.dedupeMinutes)) ? Math.max(1, Number(input.dedupeMinutes)) : 30;
  const dup = await pool.query(
    `SELECT id FROM noc_alerts WHERE source=$1 AND title=$2 AND acknowledged=false AND created_at >= now() - ($3 || ' minutes')::interval LIMIT 1`,
    [source, title, String(dedupeMinutes)]
  ).catch(() => ({ rows: [] as any[] }));
  if (dup.rows[0]) return dup.rows[0];

  const row = (await pool.query(
    `INSERT INTO noc_alerts(severity, source, title, message, details)
     VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *`,
    [safeSeverity, source, title, input.message || null, JSON.stringify(input.details || {})]
  ).catch(() => ({ rows: [] as any[] }))).rows[0];

  // Best-effort delivery to configured Telegram NOC channel. Never fail the caller.
  try {
    await dispatchMessage({
      channel_type: 'TELEGRAM',
      template_name: 'noc_alert_telegram',
      variables: { title: input.title, details: input.message || '', time: new Date().toISOString(), severity: safeSeverity, source: input.source },
      related_type: 'NOC_ALERT',
      related_id: row?.id ? String(row.id) : undefined,
      requireEnabled: false,
    });
  } catch { /* optional delivery */ }

  return row || null;
}
