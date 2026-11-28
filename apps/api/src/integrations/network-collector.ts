import { pool } from '../db';
import { mikrotikActiveSessions, mikrotikTelemetry } from './mikrotik';
import { mikrotikErrorMessage } from './mikrotik-errors';
import { emitNocAlert } from './noc-alerts';
import { probeRadiusNas } from './radius';
import { LITE_MODE, SESSIONS_COLLECTOR_MS, TELEMETRY_COLLECTOR_MS } from '../config/runtime';
import { tryAcquireSchedulerLock } from './billing';
import { withSchedulerRun } from './scheduler-observability';
import { recordOnuOpticalSamples, recordRouterTelemetrySample, recordSubscriberSessionSamples } from './telemetry-history';
import { publishLiveSessionsSnapshot } from './live-sessions';
import { oltRefreshTelemetry } from './olt';
import { isQueuesActive, registerQueueHandler, scheduleRecurringJob } from '../infra/queues';

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
        await pool.query('UPDATE network_routers SET last_error=$1, updated_at=now() WHERE id=$2', [mikrotikErrorMessage(e, rt).slice(0, 500), rt.id]).catch(() => {});
      }
    }

    const sessionSamples: any[] = [];
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
      if (online) {
        sessionSamples.push({ subscriber_id: s.id, router_id: rt.id, username: uname, status: 'ONLINE', rx_bps: rx, tx_bps: tx, rx_bytes: rx * 5, tx_bytes: tx * 5 });
      }
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
        sessionSamples.push({ subscriber_id: sub?.id || null, router_id: rt.id, username: uname, status: 'ONLINE', rx_bps: 0, tx_bps: 0, rx_bytes: Number(a.acctoutputoctets || 0), tx_bytes: Number(a.acctinputoctets || 0) });
      }
    } catch (_e) { /* radacct not available */ }

    await recordSubscriberSessionSamples(sessionSamples);
    await publishLiveSessionsSnapshot().catch(() => {});

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
        await pool.query('UPDATE network_routers SET cpu_load=$1,memory_used_mb=$2,memory_total_mb=$3,rx_bps=$4,tx_bps=$5,uptime_seconds=$6,status=$7,last_seen_at=COALESCE($8,last_seen_at),identity=COALESCE($9,identity),board_name=COALESCE($10,board_name),last_error=NULL,updated_at=now() WHERE id=$11',
          [merged.cpu_load ?? row.cpu_load ?? null, merged.memory_used_mb ?? row.memory_used_mb ?? null, merged.memory_total_mb ?? row.memory_total_mb ?? null, merged.rx_bps ?? row.rx_bps ?? 0, merged.tx_bps ?? row.tx_bps ?? 0, merged.uptime_seconds ?? row.uptime_seconds ?? null, merged.status || row.status, merged.last_seen_at || null, merged.identity || null, merged.board_name || null, row.id]);
        const sessCnt = await pool.query(`SELECT COUNT(*)::int AS c FROM subscriber_sessions WHERE router_id=$1 AND status='ONLINE'`, [row.id]).catch(() => ({ rows: [{ c: 0 }] }));
        await recordRouterTelemetrySample({
          router_id: row.id,
          status: merged.status || 'ONLINE',
          cpu_load: merged.cpu_load ?? null,
          memory_used_mb: merged.memory_used_mb ?? null,
          memory_total_mb: merged.memory_total_mb ?? null,
          rx_bps: merged.rx_bps ?? 0,
          tx_bps: merged.tx_bps ?? 0,
          active_sessions: sessCnt.rows[0]?.c || 0,
        });
      } catch (e: any) {
        const errMsg = mikrotikErrorMessage(e, row).slice(0, 500);
        await pool.query('UPDATE network_routers SET status=$1,last_error=$2,updated_at=now() WHERE id=$3', ['OFFLINE', errMsg, row.id]).catch(() => {});
        await emitNocAlert({ severity: 'CRITICAL', source: 'ROUTER', title: `Router offline: ${row.name || row.id}`, message: errMsg, details: { router_id: row.id, host: row.host }, dedupeMinutes: 30 }).catch(() => {});
      }
    }
    const radiusRows = (await pool.query(`SELECT * FROM network_routers WHERE is_enabled = true AND upper(integration_mode) = 'RADIUS' ORDER BY created_at ASC`)).rows;
    for (const row of radiusRows) {
      try {
        const probe = await probeRadiusNas(row);
        if (probe.reachable) {
          await pool.query('UPDATE network_routers SET status=$1,last_seen_at=now(),last_error=NULL,updated_at=now() WHERE id=$2', ['ONLINE', row.id]).catch(() => {});
        } else {
          const errMsg = String(probe.error || 'RADIUS NAS unreachable').slice(0, 500);
          await pool.query('UPDATE network_routers SET status=$1,last_error=$2,updated_at=now() WHERE id=$3', ['OFFLINE', errMsg, row.id]).catch(() => {});
          await emitNocAlert({ severity: 'WARNING', source: 'ROUTER', title: `RADIUS NAS offline: ${row.name || row.id}`, message: errMsg, details: { router_id: row.id, host: row.host }, dedupeMinutes: 30 }).catch(() => {});
        }
      } catch (e: any) {
        const errMsg = String(e?.message || 'RADIUS probe failed').slice(0, 500);
        await pool.query('UPDATE network_routers SET status=$1,last_error=$2,updated_at=now() WHERE id=$3', ['OFFLINE', errMsg, row.id]).catch(() => {});
      }
    }
    return { ok: true, routers: rows.length + radiusRows.length };
  } catch (e: any) {
    return { ok: false, routers: 0, error: e?.message || String(e) };
  } finally {
    telemetryRunning = false;
  }
}

export async function collectOltOpticalOnce(): Promise<{ ok: boolean; olts: number; samples: number }> {
  try {
    const olts = (await pool.query('SELECT * FROM olts WHERE is_enabled=true ORDER BY created_at ASC')).rows;
    if (!olts.length) return { ok: true, olts: 0, samples: 0 };
    let totalSamples = 0;
    for (const olt of olts) {
      const onus = (await pool.query('SELECT * FROM onus WHERE olt_id=$1', [olt.id])).rows;
      if (!onus.length) continue;
      const resTel = await oltRefreshTelemetry(olt, onus).catch(() => null);
      if (!resTel || resTel.mode !== 'snmp') continue;
      const byId = new Map((resTel.onus || []).map((t: any) => [String(t.id), t]));
      const samples: any[] = [];
      for (const o of onus) {
        const t: any = byId.get(String(o.id)) || o;
        const rx = t.rx_power_dbm == null ? null : +Number(t.rx_power_dbm).toFixed(2);
        const tx = t.tx_power_dbm == null ? null : +Number(t.tx_power_dbm).toFixed(2);
        const temp = t.temperature_c == null ? null : +Number(t.temperature_c).toFixed(2);
        const dist = t.distance_m == null ? null : Math.round(Number(t.distance_m));
        const st = o.status === 'AUTHORIZED' ? 'AUTHORIZED' : (t.status || o.status || 'DISCOVERED');
        await pool.query(
          'UPDATE onus SET rx_power_dbm=COALESCE($1,rx_power_dbm), tx_power_dbm=COALESCE($2,tx_power_dbm), temperature_c=COALESCE($4,temperature_c), distance_m=COALESCE($5,distance_m), status=$6, last_seen_at=now(), updated_at=now() WHERE id=$3',
          [rx, tx, o.id, temp, dist, st],
        ).catch(() => {});
        samples.push({
          onu_id: o.id,
          olt_id: olt.id,
          subscriber_id: o.subscriber_id,
          status: st,
          rx_power_dbm: rx ?? o.rx_power_dbm,
          tx_power_dbm: tx ?? o.tx_power_dbm,
          temperature_c: temp ?? o.temperature_c,
          distance_m: dist ?? o.distance_m,
        });
      }
      if (samples.length) {
        await recordOnuOpticalSamples(samples);
        totalSamples += samples.length;
      }
    }
    return { ok: true, olts: olts.length, samples: totalSamples };
  } catch {
    return { ok: false, olts: 0, samples: 0 };
  }
}

export function startNetworkCollector() {
  if (LITE_MODE) {
    console.log('[NetworkCollector] lite mode: collectors disabled (set IZAN_LITE=false to enable)');
    return;
  }
  const runSessions = async () => {
    try {
      await withSchedulerRun('collector:sessions', async () => {
        const locked = await tryAcquireSchedulerLock('collector:sessions', Math.max(15_000, SESSIONS_COLLECTOR_MS - 5_000)).catch(() => false);
        if (!locked) return { skipped: 'lock' };
        const r = await collectSessionsOnce();
        if (!r.ok) throw new Error(r.error || 'sessions collection failed');
        return r;
      });
    } catch (e: any) { console.warn('[NetworkCollector] sessions error:', e.message); }
  };
  const runTelemetry = async () => {
    try {
      await withSchedulerRun('collector:telemetry', async () => {
        const locked = await tryAcquireSchedulerLock('collector:telemetry', Math.max(15_000, TELEMETRY_COLLECTOR_MS - 5_000)).catch(() => false);
        if (!locked) return { skipped: 'lock' };
        const r = await collectTelemetryOnce();
        if (!r.ok) throw new Error(r.error || 'telemetry collection failed');
        return r;
      });
    } catch (e: any) { console.warn('[NetworkCollector] telemetry error:', e.message); }
  };
  const runOltOptical = async () => {
    try {
      await withSchedulerRun('collector:olt-optical', async () => {
        const locked = await tryAcquireSchedulerLock('collector:olt-optical', 4 * 60 * 1000).catch(() => false);
        if (!locked) return { skipped: 'lock' };
        return await collectOltOpticalOnce();
      });
    } catch (e: any) { console.warn('[NetworkCollector] olt-optical error:', e.message); }
  };

  registerQueueHandler('network', 'sessions-collect', runSessions);
  registerQueueHandler('network', 'telemetry-collect', runTelemetry);
  registerQueueHandler('network', 'olt-telemetry-sweep', runOltOptical);

  if (isQueuesActive()) {
    if (SESSIONS_COLLECTOR_MS > 0) void scheduleRecurringJob('network', 'sched:sessions-collect', 'sessions-collect', SESSIONS_COLLECTOR_MS);
    if (TELEMETRY_COLLECTOR_MS > 0) void scheduleRecurringJob('network', 'sched:telemetry-collect', 'telemetry-collect', TELEMETRY_COLLECTOR_MS);
    void scheduleRecurringJob('network', 'sched:olt-optical', 'olt-telemetry-sweep', 5 * 60 * 1000);
    console.log('[NetworkCollector] scheduled via BullMQ workers');
    return;
  }

  if (SESSIONS_COLLECTOR_MS > 0) {
    runSessions().catch(() => {});
    setInterval(runSessions, SESSIONS_COLLECTOR_MS).unref?.();
    console.log(`[NetworkCollector] sessions every ${Math.round(SESSIONS_COLLECTOR_MS / 1000)}s`);
  }
  if (TELEMETRY_COLLECTOR_MS > 0) {
    runTelemetry().catch(() => {});
    setInterval(runTelemetry, TELEMETRY_COLLECTOR_MS).unref?.();
    console.log(`[NetworkCollector] telemetry every ${Math.round(TELEMETRY_COLLECTOR_MS / 1000)}s`);
  }
  setInterval(runOltOptical, 5 * 60 * 1000).unref?.();
}
