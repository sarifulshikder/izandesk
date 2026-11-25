/**
 * Shared live-sessions snapshot & Redis Pub/Sub broadcaster used by SSE and
 * WebSocket session streams so multiple clients don't repeat DB polling queries.
 */
import { pool } from '../db';
import { isRedisReady, redisGetJson, redisPublish, redisSetJson, redisSubscribe } from '../infra/redis';

export const LIVE_SESSIONS_CHANNEL = 'iz:sessions:updates';
const LIVE_SESSIONS_KEY = 'iz:sessions:snapshot';

function formatUptimeSec(sec: number): string {
  const s = Math.max(0, Number(sec || 0));
  if (!s) return '-';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export async function queryLiveSessionsPayload() {
  const rows = (
    await pool.query(
      `SELECT ss.username, ss.rx_bps, ss.tx_bps, ss.status, ss.ip_address, ss.uptime_sec,
              r.name as router_name, r.integration_mode, s.full_name, s.provisioning_mode
       FROM subscriber_sessions ss
       LEFT JOIN network_routers r ON r.id=ss.router_id
       LEFT JOIN subscribers s ON s.id=ss.subscriber_id
       ORDER BY ss.updated_at DESC LIMIT 50`,
    )
  ).rows;
  const safeRows = rows.map((x: any) => ({ ...x, uptime: formatUptimeSec(Number(x.uptime_sec || 0)) }));
  return {
    t: Date.now(),
    sessions: safeRows,
    summary: {
      online: safeRows.filter((r: any) => r.status === 'ONLINE').length,
      aggRxBps: safeRows.reduce((a: number, r: any) => a + Number(r.rx_bps || 0), 0),
      aggTxBps: safeRows.reduce((a: number, r: any) => a + Number(r.tx_bps || 0), 0),
    },
  };
}

export async function publishLiveSessionsSnapshot() {
  const payload = await queryLiveSessionsPayload();
  if (isRedisReady()) {
    await redisSetJson(LIVE_SESSIONS_KEY, payload, 15);
    await redisPublish(LIVE_SESSIONS_CHANNEL, payload);
  }
  return payload;
}

export async function getLiveSessionsSnapshot() {
  if (isRedisReady()) {
    const cached = await redisGetJson<any>(LIVE_SESSIONS_KEY);
    if (cached && Array.isArray(cached.sessions)) return cached;
  }
  const payload = await queryLiveSessionsPayload();
  if (isRedisReady()) await redisSetJson(LIVE_SESSIONS_KEY, payload, 15);
  return payload;
}

export async function subscribeLiveSessions(handler: (payload: any) => void): Promise<() => void> {
  return await redisSubscribe(LIVE_SESSIONS_CHANNEL, (raw) => {
    try {
      const parsed = JSON.parse(raw);
      handler(parsed);
    } catch { /* ignore */ }
  });
}
