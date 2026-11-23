import { pool } from '../db';
import { mikrotikActiveSessions, mikrotikTelemetry } from './mikrotik';
import { LITE_MODE, SESSIONS_COLLECTOR_MS, TELEMETRY_COLLECTOR_MS } from '../config/runtime';

function parseUptimeSimple(s: string): number {
  let sec = 0; const re = /(\d+)(w|d|h|m|s)/g; let m: RegExpExecArray | null;
  while ((m = re.exec(String(s || '')))) { const v = Number(m[1]); sec += m[2]==='w'?v*604800:m[2]==='d'?v*86400:m[2]==='h'?v*3600:m[2]==='m'?v*60:v; }
  return sec || 0;
}

let sessionsRunning = false;
let telemetryRunning = false;

export async function collectSessionsOnce(): Promise<{ ok: boolean; routers: number; active: number; failed?: number; error?: string }> {
  if (sessionsRunning) return { ok: true, routers: 0, active: 0 };
  sessionsRunning = true;
  try {
    const subs = await pool.query(`SELECT s.id, s.username, s.full_name, s.client_code, s.status, s.connection_type, s.ip_address, s.mac_address, s.provisioning_mode, s.router_id
      FROM subscribers s WHERE s.username IS NOT NULL AND s.username <> ''`);
    const allRouters = (await pool.query('SELECT * FROM network_routers ORDER BY created_at')).rows;
    const radiusRouters = allRouters.filter((r: any) => String(r.integration_mode).toUpperCase() === 'RADIUS' && r.is_enabled);
    const directRouters = allRouters.filter((r: any) => ['API', 'REST'].includes(String(r.integration_mode).toUpperCase()) && r.is_enabled);

    const realMap = new Map<string, { router_id: string; address?: string; caller_id?: string; uptime?: string; rx_bps?: number; tx_bps?: number }>();
    const failedRouters = new Set<string>();
    for (const rt of directRouters) {
      try {
        const actives = await mikrotikActiveSessions(rt);
        for (const a of (actives || [])) {
          if (a && a.name) realMap.set(String(a.name), { router_id: rt.id, address: a.address, caller_id: a.caller_id, uptime: a.uptime, rx_bps: Number(a.rx_bps || 0), tx_bps: Number(a.tx_bps || 0) });
        }
      } catch (e: any) {
        failedRouters.add(String(rt.id));
        await pool.query('UPDATE network_routers SET last_error=$1, updated_at=now() WHERE id=$2', [String(e?.message || 'session collection failed').slice(0, 500), rt.id]).catch(() => {});
      }
    }

    for (let i = 0; i < subs.rows.length; i++) {
      const s = subs.rows[i];
      const uname = String(s.username);
      let rt: any = null;
      const real = realMap.get(uname);
      if (String(s.provisioning_mode || '').toUpperCase() === 'ROUTER' && s.router_id) {
        rt = directRouters.find((r: any) => r.id === s.router_id) || allRouters.find((r: any) => r.id === s.router_id) || null;
      } else if (real) {
        rt = allRouters.find((r: any) => r.id === real.router_id) || null;
      } else if (String(s.provisioning_mode || '').toUpperCase() === 'RADIUS') {
        if (radiusRouters.length) rt = radiusRouters[i % radiusRouters.length];
        else rt = directRouters[i % Math.max(1, directRouters.length)] || allRouters[0] || null;
      } else {
        rt = directRouters[i % Math.max(1, directRouters.length)] || allRouters[0] || null;
      }
      if (!rt) continue;
      // A failed poll is not evidence that everyone went offline. Preserve the
      // last known session state until the next successful collection.
      if (failedRouters.has(String(rt.id))) continue;

      const isDirect = ['API', 'REST'].includes(String(rt.integration_mode || '').toUpperCase());
      let online = false; let ip = s.ip_address; let mac = s.mac_address; let uptimeSec = 0; let rx = 0; let tx = 0;
      if (isDirect && real && real.router_id === rt.id) {
        online = true; ip = real.address || ip; mac = real.caller_id || mac;
        uptimeSec = parseUptimeSimple(real.uptime || '0s');
        rx = Number(real.rx_bps || 0); tx = Number(real.tx_bps || 0);
      } else if (isDirect && String(s.provisioning_mode || '').toUpperCase() === 'ROUTER') {
        online = false;
      } else {
        online = false; rx = 0; tx = 0; uptimeSec = 0;
      }
      await pool.query(`INSERT INTO subscriber_sessions(subscriber_id,router_id,username,ip_address,mac_address,rx_bps,tx_bps,rx_bytes,tx_bytes,status,uptime_sec,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
        ON CONFLICT (username, router_id) DO UPDATE SET subscriber_id=$1,ip_address=COALESCE($4,subscriber_sessions.ip_address),mac_address=COALESCE($5,subscriber_sessions.mac_address),rx_bps=$6,tx_bps=$7,rx_bytes=subscriber_sessions.rx_bytes+$6,tx_bytes=subscriber_sessions.tx_bytes+$7,status=$10,uptime_sec=$11,updated_at=now()`,
        [s.id, rt.id, uname, ip || null, mac || null, rx, tx, rx * 5, tx * 5, online ? 'ONLINE' : 'OFFLINE', uptimeSec]);
    }

    // Overlay RADIUS accounting (radacct) for live sessions where available
    try {
      const acct = await pool.query(`SELECT DISTINCT ON (username) username, framedipaddress::text as ip_address, nasipaddress::text as nas_ip, acctstarttime, acctupdatetime, acctsessiontime, acctinputoctets, acctoutputoctets
        FROM radacct WHERE acctstoptime IS NULL ORDER BY username, acctupdatetime DESC NULLS LAST, acctstarttime DESC`);
      for (const a of acct.rows) {
        const uname = String(a.username || '');
        if (!uname) continue;
        const sub = subs.rows.find((s: any) => String(s.username) === uname);
        let rt = radiusRouters[0] || directRouters[0] || allRouters[0];
        if (sub && String(sub.provisioning_mode || '').toUpperCase() === 'ROUTER' && sub.router_id) rt = allRouters.find((r: any) => r.id === sub.router_id) || rt;
        if (!rt) continue;
        const uptimeSec = Number(a.acctsessiontime || 0);
        await pool.query(`INSERT INTO subscriber_sessions(subscriber_id,router_id,username,ip_address,mac_address,rx_bps,tx_bps,rx_bytes,tx_bytes,status,uptime_sec,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ONLINE',$10,now())
          ON CONFLICT (username, router_id) DO UPDATE SET subscriber_id=COALESCE($1,subscriber_sessions.subscriber_id),ip_address=COALESCE($4,subscriber_sessions.ip_address),status='ONLINE',rx_bps=0,tx_bps=0,rx_bytes=$8,tx_bytes=$9,uptime_sec=$10,updated_at=now()`,
          [sub?.id || null, rt.id, uname, a.ip_address || sub?.ip_address || null, sub?.mac_address || null, 0, 0, Number(a.acctoutputoctets || 0), Number(a.acctinputoctets || 0), uptimeSec]);
      }
    } catch (_e) { /* radacct not available */ }

    return { ok: true, routers: directRouters.length, active: realMap.size, failed: failedRouters.size };
  } catch (e: any) {
    return { ok: false, routers: 0, active: 0, error: e?.message || String(e) };
  } finally {
    sessionsRunning = false;
  }
}

export async function collectTelemetryOnce(): Promise<{ ok: boolean; routers: number; error?: string }> {
  if (telemetryRunning) return { ok: true, routers: 0 };
  telemetryRunning = true;
  try {
    const rows = (await pool.query(`SELECT * FROM network_routers WHERE is_enabled = true AND upper(integration_mode) IN ('API','REST') ORDER BY created_at ASC`)).rows;
    for (const row of rows) {
      try {
        const live = await mikrotikTelemetry(row);
        const merged = { ...row, ...live, last_seen_at: new Date().toISOString() };
        await pool.query('UPDATE network_routers SET cpu_load=$1,memory_used_mb=$2,memory_total_mb=$3,rx_bps=$4,tx_bps=$5,uptime_seconds=$6,status=$7,last_seen_at=COALESCE($8,last_seen_at),identity=COALESCE($9,identity),board_name=COALESCE($10,board_name),updated_at=now() WHERE id=$11',
          [merged.cpu_load ?? row.cpu_load ?? null, merged.memory_used_mb ?? row.memory_used_mb ?? null, merged.memory_total_mb ?? row.memory_total_mb ?? null, merged.rx_bps ?? row.rx_bps ?? 0, merged.tx_bps ?? row.tx_bps ?? 0, merged.uptime_seconds ?? row.uptime_seconds ?? null, merged.status || row.status, merged.last_seen_at || null, merged.identity || null, merged.board_name || null, row.id]);
      } catch (e: any) {
        await pool.query('UPDATE network_routers SET status=$1,last_error=$2,updated_at=now() WHERE id=$3', ['OFFLINE', String(e?.message || 'unreachable').slice(0, 500), row.id]).catch(() => {});
      }
    }
    return { ok: true, routers: rows.length };
  } catch (e: any) {
    return { ok: false, routers: 0, error: e?.message || String(e) };
  } finally {
    telemetryRunning = false;
  }
}

export function startNetworkCollector() {
  if (LITE_MODE) {
    console.log('[NetworkCollector] lite mode: collectors disabled (set IZAN_LITE=false to enable)');
    return;
  }
  if (SESSIONS_COLLECTOR_MS > 0) {
    const run = async () => { const r = await collectSessionsOnce(); if (!r.ok) console.warn('[NetworkCollector] sessions error:', r.error); };
    run().catch(() => {});
    setInterval(run, SESSIONS_COLLECTOR_MS).unref?.();
    console.log(`[NetworkCollector] sessions every ${Math.round(SESSIONS_COLLECTOR_MS / 1000)}s`);
  }
  if (TELEMETRY_COLLECTOR_MS > 0) {
    const run = async () => { const r = await collectTelemetryOnce(); if (!r.ok) console.warn('[NetworkCollector] telemetry error:', r.error); };
    run().catch(() => {});
    setInterval(run, TELEMETRY_COLLECTOR_MS).unref?.();
    console.log(`[NetworkCollector] telemetry every ${Math.round(TELEMETRY_COLLECTOR_MS / 1000)}s`);
  }
}
