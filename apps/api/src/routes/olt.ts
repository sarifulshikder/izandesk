import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, sanitizeOlt, sanitizeOlts, networkGuard } from './helpers';
import { oltTest, oltDiscoverOnus, oltRefreshTelemetry } from '../integrations/olt';
import { autoLinkOnusBulk } from '../integrations/onu-autolink';
import { syncOnuToInventory, syncAllLinkedOnusToInventory } from '../integrations/onu-inventory-sync';
import { encryptSecretValue } from '../security/secret-store';
import { getOnuOpticalHistory, recordOnuOpticalSamples } from '../integrations/telemetry-history';

const router: Router = Router();
router.use(networkGuard);

function opticalStatus(rx: number | null) {
  if (rx == null) return 'UNKNOWN';
  // Over-power (>= -8 dBm) and severe loss (<= -27 dBm) are both critical;
  // -27..-25 is a warning. The old ordering made -29 "WARNING" but -30
  // "CRITICAL", which inverted the severity of weaker signals.
  if (rx >= -8 || rx <= -27) return 'CRITICAL';
  if (rx <= -25) return 'WARNING';
  return 'NORMAL';
}

router.get('/olts', asyncHandler(async (_req, res) => {
  const r = await pool.query(`SELECT o.*, p.name as wg_peer_name, p.tunnel_ip as wg_peer_tunnel_ip, p.site_name as wg_peer_site
    FROM olts o LEFT JOIN wg_peers p ON p.id=o.wg_peer_id ORDER BY o.created_at DESC`);
  res.json({ data: sanitizeOlts(r.rows) });
}));

router.get('/olts/:id', asyncHandler(async (req, res) => {
  const r = await pool.query(`SELECT o.*, p.name as wg_peer_name, p.tunnel_ip as wg_peer_tunnel_ip, p.site_name as wg_peer_site
    FROM olts o LEFT JOIN wg_peers p ON p.id=o.wg_peer_id WHERE o.id=$1`, [req.params.id]);
  const olt = r.rows[0];
  if (!olt) return res.status(404).json({ message: 'OLT not found' });
  const stats = await pool.query(`SELECT
      COUNT(*)::int AS total_onus,
      COUNT(*) FILTER (WHERE status='ONLINE')::int AS online_onus,
      COUNT(*) FILTER (WHERE status='OFFLINE')::int AS offline_onus,
      COUNT(*) FILTER (WHERE status='AUTHORIZED')::int AS authorized_onus,
      COUNT(*) FILTER (WHERE status='DISCOVERED')::int AS discovered_onus,
      COUNT(*) FILTER (WHERE subscriber_id IS NOT NULL)::int AS linked_onus,
      AVG(rx_power_dbm)::float AS avg_rx_power_dbm
    FROM onus WHERE olt_id=$1`, [req.params.id]);
  res.json({ ...sanitizeOlt(olt), stats: stats.rows[0] || {} });
}));

router.post('/olts', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.host) return res.status(400).json({ message: 'name and host are required' });
  const wg_peer_id = b.wg_peer_id || null;
  const encPass = encryptSecretValue(b.password);
  const encComm = encryptSecretValue(b.snmp_community || 'public') || 'public';
  const r = await pool.query(`INSERT INTO olts(name,vendor,model,host,ssh_port,snmp_port,username,password,snmp_community,site,wg_peer_id,is_enabled,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'UNKNOWN') RETURNING *`,
    [b.name,b.vendor||'HUAWEI',b.model||null,b.host,b.ssh_port||23,b.snmp_port||161,b.username||'admin',encPass,encComm,b.site||null,wg_peer_id,b.is_enabled!==false]);
  const row = r.rows[0];
  // auto-sync OLT host route into bound WG peer for tunnel-aware polling
  if (row && row.wg_peer_id && row.host) {
    try {
      await pool.query(`UPDATE wg_peers SET olt_mgmt_cidrs = ARRAY(SELECT DISTINCT unnest(COALESCE(olt_mgmt_cidrs,'{}'::text[]) || ARRAY[$2::text])), updated_at=now() WHERE id=$1`,
        [row.wg_peer_id, `${String(row.host).trim()}/32`]);
      const { writeHubConfigFile, buildRouterOsScript } = await import('../integrations/wireguard');
      const path = await import('path');
      const WG_CONFIG_DIR = process.env.WG_CONFIG_DIR || path.resolve(__dirname, '../../../../docker/wg-hub/config');
      const hub = (await pool.query('SELECT * FROM wg_hub_config ORDER BY created_at ASC LIMIT 1')).rows[0];
      if (hub) {
        const peers = (await pool.query('SELECT * FROM wg_peers')).rows;
        await writeHubConfigFile(WG_CONFIG_DIR, hub, peers);
      }
    } catch {}
  }
  res.status(201).json(sanitizeOlt(row));
}));

router.put('/olts/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const c = (await pool.query('SELECT * FROM olts WHERE id=$1',[req.params.id])).rows[0];
  if (!c) return res.status(404).json({ message: 'OLT not found' });
  const wg_peer_id = (b.wg_peer_id !== undefined) ? (b.wg_peer_id || null) : c.wg_peer_id;
  const snmpCommunity = (b.snmp_community === undefined || b.snmp_community === '') ? c.snmp_community : (encryptSecretValue(b.snmp_community) || c.snmp_community);
  const encPass = (b.password === undefined || b.password === '') ? '' : (encryptSecretValue(b.password) || '');
  const r = await pool.query(`UPDATE olts SET name=$1,vendor=$2,model=$3,host=$4,ssh_port=$5,snmp_port=$6,username=$7,password=COALESCE(NULLIF($8,''),password),snmp_community=$9,site=$10,wg_peer_id=$11,is_enabled=$12,updated_at=now() WHERE id=$13 RETURNING *`,
    [b.name??c.name,b.vendor??c.vendor,b.model??c.model,b.host??c.host,b.ssh_port??c.ssh_port,b.snmp_port??c.snmp_port,b.username??c.username,encPass,snmpCommunity,b.site??c.site,wg_peer_id,b.is_enabled??c.is_enabled,req.params.id]);
  const row = r.rows[0];
  if (row && row.wg_peer_id && row.host) {
    try {
      await pool.query(`UPDATE wg_peers SET olt_mgmt_cidrs = ARRAY(SELECT DISTINCT unnest(COALESCE(olt_mgmt_cidrs,'{}'::text[]) || ARRAY[$2::text])), updated_at=now() WHERE id=$1`,
        [row.wg_peer_id, `${String(row.host).trim()}/32`]);
      const { writeHubConfigFile } = await import('../integrations/wireguard');
      const path = await import('path');
      const WG_CONFIG_DIR = process.env.WG_CONFIG_DIR || path.resolve(__dirname, '../../../../docker/wg-hub/config');
      const hub = (await pool.query('SELECT * FROM wg_hub_config ORDER BY created_at ASC LIMIT 1')).rows[0];
      if (hub) {
        const peers = (await pool.query('SELECT * FROM wg_peers')).rows;
        await writeHubConfigFile(WG_CONFIG_DIR, hub, peers);
      }
    } catch {}
  }
  res.json(sanitizeOlt(row));
}));

router.delete('/olts/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM olts WHERE id=$1',[req.params.id]);
  res.json({ ok: true });
}));

router.post('/olts/:id/test', asyncHandler(async (req, res) => {
  const olt = (await pool.query('SELECT * FROM olts WHERE id=$1',[req.params.id])).rows[0];
  if (!olt) return res.status(404).json({ message: 'OLT not found' });
  const result = await oltTest(olt);
  if (result.ok) {
    const r = await pool.query('UPDATE olts SET status=\'ONLINE\', last_seen_at=now(), updated_at=now(), model=COALESCE($2,model) WHERE id=$1 RETURNING *',[req.params.id, result.sysName || null]);
    return res.json({ ok: true, mode: result.mode, message: `OLT reachable via SNMP${result.sysName ? ` (${result.sysName})` : ''}.`, sysDescr: result.sysDescr, sysName: result.sysName, uptime: result.uptime, olt: sanitizeOlt(r.rows[0]) });
  }
  const r = await pool.query('UPDATE olts SET status=\'OFFLINE\', updated_at=now() WHERE id=$1 RETURNING *',[req.params.id]);
  return res.json({ ok: false, mode: result.mode, message: `SNMP test failed/unavailable: ${result.error}. Configure SNMP access and ensure SNMP tools are available for real polling.`, olt: sanitizeOlt(r.rows[0]) });
}));

// ONUs list
router.get('/onus', asyncHandler(async (req, res) => {
  const { olt_id, status, q } = req.query as any;
  const where: string[] = []; const params: any[] = [];
  if (olt_id) { params.push(olt_id); where.push(`o.olt_id=$${params.length}`); }
  if (status) { params.push(status); where.push(`o.status=$${params.length}`); }
  if (q) { params.push(`%${String(q).toLowerCase()}%`); where.push(`(lower(COALESCE(o.serial_number,'')) LIKE $${params.length} OR lower(COALESCE(o.name,'')) LIKE $${params.length} OR lower(COALESCE(o.pon_port,'')) LIKE $${params.length})`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(`SELECT o.*, ol.name as olt_name, ol.vendor as olt_vendor, s.full_name as subscriber_name, s.client_code as subscriber_code
    FROM onus o JOIN olts ol ON ol.id=o.olt_id LEFT JOIN subscribers s ON s.id=o.subscriber_id ${whereSql} ORDER BY o.updated_at DESC`, params);
  const rows = r.rows.map((x:any)=>({ ...x, optical_status: opticalStatus(x.rx_power_dbm != null ? Number(x.rx_power_dbm) : null) }));
  res.json({ data: rows });
}));

// Discover unconfigured ONUs (SNMP-capable adapter with fallback)
router.post('/olts/:id/discover', asyncHandler(async (req, res) => {
  const olt = (await pool.query('SELECT * FROM olts WHERE id=$1',[req.params.id])).rows[0];
  if (!olt) return res.status(404).json({ message: 'OLT not found' });
  const result = await oltDiscoverOnus(olt);
  // Only parsed IF-MIB/vendor discovery is trustworthy. Simulated and
  // "unsupported OID" fallbacks must never be persisted as real topology.
  const trusted = result.ok === true && result.mode === 'snmp';
  const simulated = !trusted;
  const discovered: any[] = [];
  for (const n of (trusted ? (result.onus || []) : [])) {
    const rx = n.rx_power_dbm != null ? Number(n.rx_power_dbm) : null;
    const tx = n.tx_power_dbm != null ? Number(n.tx_power_dbm) : null;
    const temp = n.temperature_c != null ? Number(n.temperature_c) : null;
    const volt = n.voltage_v != null ? Number(n.voltage_v) : null;
    const bias = n.tx_bias_ma != null ? Number(n.tx_bias_ma) : null;
    const mac = n.mac_address ? String(n.mac_address).toLowerCase() : null;
    const dist = n.distance_m != null ? Math.round(Number(n.distance_m)) : null;
    const lastDown = n.last_down_cause ? String(n.last_down_cause) : null;
    const status = ['ONLINE','OFFLINE','DISCOVERED','AUTHORIZED','LOS','DYING_GASP'].includes(String(n.status||'').toUpperCase()) ? String(n.status).toUpperCase() : 'DISCOVERED';
    const r = await pool.query(`INSERT INTO onus(olt_id,pon_port,onu_id,serial_number,name,status,rx_power_dbm,tx_power_dbm,temperature_c,voltage_v,tx_bias_ma,mac_address,distance_m,last_down_cause,last_seen_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
      ON CONFLICT (olt_id, pon_port, serial_number) DO UPDATE SET
        name=COALESCE(NULLIF($5,''), onus.name),
        onu_id=COALESCE($3, onus.onu_id),
        rx_power_dbm=COALESCE($7,onus.rx_power_dbm),
        tx_power_dbm=COALESCE($8,onus.tx_power_dbm),
        temperature_c=COALESCE($9,onus.temperature_c),
        voltage_v=COALESCE($10,onus.voltage_v),
        tx_bias_ma=COALESCE($11,onus.tx_bias_ma),
        mac_address=COALESCE($12,onus.mac_address),
        distance_m=COALESCE($13,onus.distance_m),
        last_down_cause=COALESCE($14,onus.last_down_cause),
        last_seen_at=now(),
        status=CASE WHEN onus.status='AUTHORIZED' THEN onus.status ELSE $6 END,
        updated_at=now()
      RETURNING *`,
      [olt.id, n.pon_port || '0/1/1', n.onu_id || null, n.serial_number, n.name || `ONU-${n.serial_number}`, status, rx, tx, temp, volt, bias, mac, dist, lastDown]);
    discovered.push({ ...r.rows[0], optical_status: opticalStatus(r.rows[0].rx_power_dbm != null ? Number(r.rows[0].rx_power_dbm) : null) });
  }
  if (discovered.length) {
    await recordOnuOpticalSamples(discovered.map((d: any) => ({
      onu_id: d.id,
      olt_id: d.olt_id,
      subscriber_id: d.subscriber_id,
      status: d.status,
      rx_power_dbm: d.rx_power_dbm,
      tx_power_dbm: d.tx_power_dbm,
      temperature_c: d.temperature_c,
      distance_m: d.distance_m,
    })));
  }
  if (result.ok && !simulated) await pool.query('UPDATE olts SET status=\'ONLINE\', last_seen_at=now(), updated_at=now() WHERE id=$1',[olt.id]);
  let autoLinked: any = null;
  try { autoLinked = await autoLinkOnusBulk({ allowFdb: true, limit: 300 }); } catch {}
  res.json({ ok: !!result.ok && !simulated, mode: result.mode, discovered: discovered.length, onus: discovered, auto_linked: autoLinked?.linked?.length || 0, note: result.note || result.error || (simulated ? 'SNMP discovery unavailable; no simulated ONUs were written. Provide SNMP access/tools and vendor OID mapping for real discovery.' : 'Discovered via SNMP (best-effort OID mapping).') });
}));

// Bulk auto-link discovered ONUs to subscribers (name/client_code + MAC/FDB correlation)
router.post('/auto-link', asyncHandler(async (req, res) => {
  const allowFdb = req.body?.allowFdb !== false;
  const limit = Math.max(1, Math.min(Number(req.body?.limit || 500), 2000));
  const result = await autoLinkOnusBulk({ allowFdb, limit });
  res.json({ ok: true, ...result });
}));

// Trick: import all subscriber-linked ONUs into inventory & serial tracking
router.post('/sync-inventory', asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.body?.limit || 500), 2000));
  const result = await syncAllLinkedOnusToInventory({ limit });
  res.json({ ok: true, ...result, note: 'Linked ONUs imported into inventory_items (category ONU) + inventory_serials (ASSIGNED) + subscriber_equipment (type ONU).' });
}));

// Trick: sync a single ONU to inventory (when linked/authorized manually)
router.post('/onus/:id/sync-inventory', asyncHandler(async (req, res) => {
  const r = await syncOnuToInventory(req.params.id);
  if (!r) return res.status(400).json({ ok: false, message: 'ONU not found or not linked to a subscriber' });
  res.json({ ok: true, ...r });
}));

// Authorize ONU (1-click)
router.post('/onus/:id/authorize', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const onu = (await pool.query('SELECT * FROM onus WHERE id=$1',[req.params.id])).rows[0];
  if (!onu) return res.status(404).json({ message: 'ONU not found' });
  if (b.subscriber_id) {
    const sub = await pool.query('SELECT id FROM subscribers WHERE id=$1', [b.subscriber_id]);
    if (!sub.rows[0]) return res.status(404).json({ message: 'Subscriber not found' });
  }
  const subId = b.subscriber_id || onu.subscriber_id || null;
  const name = b.name || onu.name || onu.serial_number;
  const r = await pool.query(`UPDATE onus SET status='AUTHORIZED', name=$1, subscriber_id=$2, authorized_at=COALESCE(authorized_at,now()), last_seen_at=now(), updated_at=now() WHERE id=$3 RETURNING *`,
    [name, subId, req.params.id]);
  // trick: auto-import authorized+linked ONU into inventory & serial tracking
  let invSync: any = null;
  if (subId) { try { invSync = await syncOnuToInventory(req.params.id); } catch {} }
  res.json({ ok: true, message: 'ONU authorized successfully (simulated OLT provisioning).', inventory_sync: invSync, onu: { ...r.rows[0], optical_status: opticalStatus(r.rows[0].rx_power_dbm != null ? Number(r.rows[0].rx_power_dbm) : null) } });
}));

// Refresh telemetry (SNMP-capable adapter with fallback)
router.post('/onus/refresh-telemetry', asyncHandler(async (req, res) => {
  const { olt_id } = req.body || {};
  const q = olt_id ? 'SELECT o.*, ol.host, ol.snmp_port, ol.snmp_community, ol.vendor, ol.model FROM onus o JOIN olts ol ON ol.id=o.olt_id WHERE o.olt_id=$1' : 'SELECT o.*, ol.host, ol.snmp_port, ol.snmp_community, ol.vendor, ol.model FROM onus o JOIN olts ol ON ol.id=o.olt_id';
  const params = olt_id ? [olt_id] : [];
  const onus = (await pool.query(q, params)).rows;
  let mode: string = 'simulated';
  // One SNMP walk set per OLT, not per ONU. Grouping avoids O(N) full walks.
  const groups = new Map<string, any[]>();
  for (const o of onus) {
    const key = String(o.olt_id || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  const opticalSamples: any[] = [];
  for (const [oltId, list] of groups) {
    const first = list[0];
    const resTel = await oltRefreshTelemetry({ host: first.host, snmp_port: first.snmp_port, snmp_community: first.snmp_community, vendor: first.vendor, model: first.model }, list);
    mode = resTel.mode || mode;
    // Never overwrite real telemetry with simulated/random values.
    if (resTel.mode === 'simulated') continue;
    const byId = new Map((resTel.onus || []).map((t: any) => [String(t.id), t]));
    for (const o of list) {
      const t: any = byId.get(String(o.id)) || o;
      const rx = t.rx_power_dbm == null ? null : (+Number(t.rx_power_dbm).toFixed(2));
      const tx = t.tx_power_dbm == null ? null : (+Number(t.tx_power_dbm).toFixed(2));
      const temp = t.temperature_c == null ? null : (+Number(t.temperature_c).toFixed(2));
      const volt = t.voltage_v == null ? null : (+Number(t.voltage_v).toFixed(2));
      const bias = t.tx_bias_ma == null ? null : (+Number(t.tx_bias_ma).toFixed(2));
      const mac = t.mac_address ? String(t.mac_address).toLowerCase() : null;
      const dist = t.distance_m == null ? null : Math.round(Number(t.distance_m));
      const lastDown = t.last_down_cause ? String(t.last_down_cause) : null;
      const st = (o.status === 'AUTHORIZED') ? 'AUTHORIZED' : (t.status || o.status || 'DISCOVERED');
      await pool.query('UPDATE onus SET rx_power_dbm=COALESCE($1,rx_power_dbm), tx_power_dbm=COALESCE($2,tx_power_dbm), mac_address=COALESCE($5,mac_address), distance_m=COALESCE($6,distance_m), last_down_cause=COALESCE($7,last_down_cause), temperature_c=COALESCE($8,temperature_c), voltage_v=COALESCE($9,voltage_v), tx_bias_ma=COALESCE($10,tx_bias_ma), status=$4, last_seen_at=now(), updated_at=now() WHERE id=$3', [rx, tx, o.id, st, mac, dist, lastDown, temp, volt, bias]);
      opticalSamples.push({
        onu_id: o.id,
        olt_id: oltId,
        subscriber_id: o.subscriber_id,
        status: st,
        rx_power_dbm: rx ?? o.rx_power_dbm,
        tx_power_dbm: tx ?? o.tx_power_dbm,
        temperature_c: temp ?? o.temperature_c,
        distance_m: dist ?? o.distance_m,
      });
    }
  }
  if (opticalSamples.length) await recordOnuOpticalSamples(opticalSamples);
  const r = await pool.query(`SELECT o.*, ol.name as olt_name, ol.vendor as olt_vendor, s.full_name as subscriber_name, s.client_code as subscriber_code
    FROM onus o JOIN olts ol ON ol.id=o.olt_id LEFT JOIN subscribers s ON s.id=o.subscriber_id ${olt_id ? 'WHERE o.olt_id=$1':''} ORDER BY o.updated_at DESC`, params);
  const rows = r.rows.map((x:any)=>({ ...x, optical_status: opticalStatus(x.rx_power_dbm != null ? Number(x.rx_power_dbm) : null) }));
  res.json({ ok: true, mode, updated: rows.length, data: rows, note: mode === 'snmp' ? 'Telemetry refreshed via SNMP (best-effort status; optical power may require vendor-specific OIDs).' : 'Real per-ONU optical telemetry requires SNMP tools/access and vendor/model ONU index mapping; simulated fallback used where unavailable.' });
}));

router.get('/onus/:id/history', asyncHandler(async (req, res) => {
  const hours = Math.max(1, Math.min(24 * 90, Number(req.query.hours || 168) || 168));
  const data = await getOnuOpticalHistory(String(req.params.id), hours);
  res.json({ ok: true, hours, data });
}));

export default router;
