/**
 * Time-series telemetry storage & bucketed query helpers for routers,
 * subscriber sessions, and OLT/ONU optical power readings.
 */
import { pool } from '../db';
import { getCached } from './settings';

export type RouterSample = {
  router_id: string;
  status?: string | null;
  cpu_load?: number | null;
  memory_used_mb?: number | null;
  memory_total_mb?: number | null;
  rx_bps?: number | null;
  tx_bps?: number | null;
  active_sessions?: number | null;
};

export type SessionSample = {
  subscriber_id?: string | null;
  router_id?: string | null;
  username: string;
  status?: string | null;
  rx_bps?: number | null;
  tx_bps?: number | null;
  rx_bytes?: number | null;
  tx_bytes?: number | null;
};

export type OnuOpticalSample = {
  onu_id: string;
  olt_id: string;
  subscriber_id?: string | null;
  status?: string | null;
  rx_power_dbm?: number | null;
  tx_power_dbm?: number | null;
  temperature_c?: number | null;
  distance_m?: number | null;
};

function bucketExpr(hours: number): string {
  if (hours <= 6) return `date_trunc('minute', recorded_at) - ((EXTRACT(minute FROM recorded_at)::int % 5) * interval '1 minute')`;
  if (hours <= 48) return `date_trunc('minute', recorded_at) - ((EXTRACT(minute FROM recorded_at)::int % 15) * interval '1 minute')`;
  if (hours <= 24 * 14) return `date_trunc('hour', recorded_at)`;
  return `date_trunc('day', recorded_at)`;
}

export async function recordRouterTelemetrySample(sample: RouterSample): Promise<void> {
  if (!sample?.router_id) return;
  await pool.query(
    `INSERT INTO router_telemetry_history(router_id, status, cpu_load, memory_used_mb, memory_total_mb, rx_bps, tx_bps, active_sessions)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      sample.router_id,
      sample.status || null,
      sample.cpu_load ?? null,
      sample.memory_used_mb ?? null,
      sample.memory_total_mb ?? null,
      Math.max(0, Math.round(Number(sample.rx_bps || 0))),
      Math.max(0, Math.round(Number(sample.tx_bps || 0))),
      Math.max(0, Math.round(Number(sample.active_sessions || 0))),
    ],
  ).catch(() => {});
}

export async function recordSubscriberSessionSamples(samples: SessionSample[]): Promise<void> {
  const rows = (samples || []).filter((s) => s && s.username && (s.status === 'ONLINE' || Number(s.rx_bps || 0) > 0 || Number(s.tx_bps || 0) > 0));
  if (!rows.length) return;
  const chunk = rows.slice(0, 500);
  const values: string[] = [];
  const params: any[] = [];
  for (const s of chunk) {
    const base = params.length;
    params.push(
      s.subscriber_id || null,
      s.router_id || null,
      String(s.username),
      s.status || 'ONLINE',
      Math.max(0, Math.round(Number(s.rx_bps || 0))),
      Math.max(0, Math.round(Number(s.tx_bps || 0))),
      Math.max(0, Math.round(Number(s.rx_bytes || 0))),
      Math.max(0, Math.round(Number(s.tx_bytes || 0))),
    );
    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`);
  }
  await pool.query(
    `INSERT INTO subscriber_session_history(subscriber_id, router_id, username, status, rx_bps, tx_bps, rx_bytes, tx_bytes)
     VALUES ${values.join(',')}`,
    params,
  ).catch(() => {});
}

export async function recordOnuOpticalSamples(samples: OnuOpticalSample[]): Promise<void> {
  const rows = (samples || []).filter((s) => s && s.onu_id && s.olt_id && (s.rx_power_dbm != null || s.tx_power_dbm != null || s.status));
  if (!rows.length) return;
  const chunk = rows.slice(0, 500);
  const values: string[] = [];
  const params: any[] = [];
  for (const s of chunk) {
    const base = params.length;
    params.push(
      s.onu_id,
      s.olt_id,
      s.subscriber_id || null,
      s.status || null,
      s.rx_power_dbm != null ? Number(s.rx_power_dbm) : null,
      s.tx_power_dbm != null ? Number(s.tx_power_dbm) : null,
      s.temperature_c != null ? Number(s.temperature_c) : null,
      s.distance_m != null ? Math.round(Number(s.distance_m)) : null,
    );
    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`);
  }
  await pool.query(
    `INSERT INTO onu_optical_history(onu_id, olt_id, subscriber_id, status, rx_power_dbm, tx_power_dbm, temperature_c, distance_m)
     VALUES ${values.join(',')}`,
    params,
  ).catch(() => {});
}

export async function getRouterTelemetryHistory(routerId: string, hours = 24) {
  const h = Math.max(1, Math.min(24 * 90, Number(hours) || 24));
  const bucket = bucketExpr(h);
  const r = await pool.query(
    `SELECT ${bucket} AS ts,
            ROUND(AVG(cpu_load)::numeric, 2)::float AS cpu_load,
            ROUND(AVG(memory_used_mb)::numeric, 2)::float AS memory_used_mb,
            ROUND(MAX(memory_total_mb)::numeric, 2)::float AS memory_total_mb,
            ROUND(AVG(rx_bps))::bigint AS rx_bps,
            ROUND(AVG(tx_bps))::bigint AS tx_bps,
            ROUND(MAX(rx_bps))::bigint AS max_rx_bps,
            ROUND(MAX(tx_bps))::bigint AS max_tx_bps,
            ROUND(AVG(active_sessions))::int AS active_sessions
     FROM router_telemetry_history
     WHERE router_id=$1 AND recorded_at >= now() - ($2 || ' hours')::interval
     GROUP BY 1
     ORDER BY 1 ASC`,
    [routerId, String(h)],
  );
  return r.rows;
}

export async function getSubscriberTelemetryHistory(subscriberId: string, hours = 24) {
  const h = Math.max(1, Math.min(24 * 90, Number(hours) || 24));
  const bucket = bucketExpr(h);
  const r = await pool.query(
    `SELECT ${bucket} AS ts,
            ROUND(AVG(rx_bps))::bigint AS rx_bps,
            ROUND(AVG(tx_bps))::bigint AS tx_bps,
            MAX(rx_bps)::bigint AS peak_rx_bps,
            MAX(tx_bps)::bigint AS peak_tx_bps,
            MAX(rx_bytes)::bigint AS rx_bytes,
            MAX(tx_bytes)::bigint AS tx_bytes
     FROM subscriber_session_history
     WHERE subscriber_id=$1 AND recorded_at >= now() - ($2 || ' hours')::interval
     GROUP BY 1
     ORDER BY 1 ASC`,
    [subscriberId, String(h)],
  );
  return r.rows;
}

export async function getOnuOpticalHistory(onuId: string, hours = 168) {
  const h = Math.max(1, Math.min(24 * 90, Number(hours) || 168));
  const bucket = bucketExpr(h);
  const r = await pool.query(
    `SELECT ${bucket} AS ts,
            ROUND(AVG(rx_power_dbm)::numeric, 2)::float AS rx_power_dbm,
            ROUND(MIN(rx_power_dbm)::numeric, 2)::float AS min_rx_power_dbm,
            ROUND(AVG(tx_power_dbm)::numeric, 2)::float AS tx_power_dbm,
            ROUND(AVG(temperature_c)::numeric, 2)::float AS temperature_c,
            MAX(distance_m)::int AS distance_m
     FROM onu_optical_history
     WHERE onu_id=$1 AND recorded_at >= now() - ($2 || ' hours')::interval
     GROUP BY 1
     ORDER BY 1 ASC`,
    [onuId, String(h)],
  );
  return r.rows;
}

export async function pruneTelemetryHistory(): Promise<{ router: number; sessions: number; onu: number }> {
  const days = Math.max(1, Number(await getCached('network.telemetry_retention_days', 30)) || 30);
  const [r1, r2, r3] = await Promise.all([
    pool.query(`DELETE FROM router_telemetry_history WHERE recorded_at < now() - ($1 || ' days')::interval`, [String(days)]).catch(() => ({ rowCount: 0 })),
    pool.query(`DELETE FROM subscriber_session_history WHERE recorded_at < now() - ($1 || ' days')::interval`, [String(days)]).catch(() => ({ rowCount: 0 })),
    pool.query(`DELETE FROM onu_optical_history WHERE recorded_at < now() - ($1 || ' days')::interval`, [String(days)]).catch(() => ({ rowCount: 0 })),
  ]);
  return {
    router: r1.rowCount || 0,
    sessions: r2.rowCount || 0,
    onu: r3.rowCount || 0,
  };
}
