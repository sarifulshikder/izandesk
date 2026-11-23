import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, networkGuard } from './helpers';
import { getCached } from '../integrations/settings';

const router: Router = Router();
// Per-user sliding-window throttle for mutating ACS actions. Connection
// requests and config writes are controlled operations; bursts get 429.
const acsWriteBuckets = new Map<string, { count: number; reset: number }>();
function acsWriteGuard(req: any, res: any, next: any) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const limit = Math.max(1, Number(process.env.ACS_WRITE_LIMIT_PER_MIN) || 10);
  const key = String(req.user?.id || 'anon');
  const now = Date.now();
  let b = acsWriteBuckets.get(key);
  if (!b || now >= b.reset) { b = { count: 0, reset: now + 60_000 }; acsWriteBuckets.set(key, b); }
  if (b.count >= limit) {
    return res.status(429).json({ ok: false, message: 'ACS mutation rate limit reached — wait a minute and retry.', retry_after_sec: Math.max(1, Math.ceil((b.reset - now) / 1000)) });
  }
  b.count++;
  return next();
}

// The link route is defined above the guards: BILLING_OPERATOR passes the read
// guard but is in this route's requireRole allowlist, so it can link devices (F4).
router.post('/devices/:id/link', requireRole(['SUPER_ADMIN','NOC_ENGINEER','BILLING_OPERATOR']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const subscriberId = req.body?.subscriber_id || null;
  if (subscriberId) {
    // Link only when the target subscriber actually exists (acs_devices.subscriber_id is FK).
    const sub = await pool.query('SELECT id FROM subscribers WHERE id=$1', [subscriberId]).catch(() => ({ rows: [] as any[] }));
    if (!sub.rows[0]) return res.status(400).json({ ok: false, message: 'No subscriber with that id' });
  }
  await pool.query(
    `INSERT INTO acs_devices(genieacs_id, subscriber_id, updated_at) VALUES($1,$2,now())
      ON CONFLICT (genieacs_id) DO UPDATE SET subscriber_id=EXCLUDED.subscriber_id, updated_at=now()`,
    [id, subscriberId]
  );
  await logAction({ device_id: id, action: 'LINK_SUBSCRIBER', payload: { subscriber_id: subscriberId }, status: 'DONE', created_by: (req as any).user?.id });
  res.json({ ok: true });
}));

router.use(acsWriteGuard);
router.use(networkGuard);

function requireRole(roles: string[]) {
  return (req: any, res: any, next: any) => {
    const role = String(req.user?.role || '');
    if (!roles.includes(role)) return res.status(403).json({ ok: false, message: 'Forbidden' });
    next();
  };
}

async function getAcsConfig() {
  const [sUrl, sUser, sPass] = await Promise.all([
    getCached('acs.genieacs_url', ''),
    getCached('acs.genieacs_user', ''),
    getCached('acs.genieacs_pass', ''),
  ]);
  const base = String(sUrl || process.env.GENIEACS_URL || process.env.ACS_URL || '').trim().replace(/\/$/, '');
  const user = String(sUser || process.env.GENIEACS_USER || process.env.ACS_USER || '').trim();
  const pass = String(sPass || process.env.GENIEACS_PASS || process.env.ACS_PASS || '');
  return { base, user, pass, configured: !!base, source: sUrl ? 'settings' : (process.env.GENIEACS_URL || process.env.ACS_URL ? 'env' : 'none') };
}

async function acsFetch(p: string, init: any = {}) {
  const cfg = await getAcsConfig();
  if (!cfg.base) throw new Error('GenieACS/TR-069 ACS is not configured. Set GenieACS URL in Settings > ACS / TR-069 or via GENIEACS_URL env.');
  const url = cfg.base + p;
  const headers: any = { ...(init.headers || {}) };
  if (init.body && headers['Content-Type'] == null) headers['Content-Type'] = 'application/json';
  if (cfg.user) headers['Authorization'] = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');
  const r = await fetch(url, { ...init, headers } as any);
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = typeof data === 'string' ? data : (data?.message || data?.error || JSON.stringify(data) || `ACS error ${r.status}`);
    const err: any = new Error(msg);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

function pv(v: any): any {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('_value' in v) return (v as any)._value;
  }
  return v;
}
function pmeta(v: any) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as any;
    return { value: pv(v), type: o._type, timestamp: o._timestamp, object: o._object, writable: o._writable };
  }
  return { value: v };
}

export function flattenParams(node: any, prefix = '', out: Array<{ path: string; value: any; type?: string; timestamp?: string; writable?: boolean; object?: boolean }> = [], depth = 0): any[] {
  if (!node || typeof node !== 'object' || depth > 20) return out;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('_')) continue;
    const path = prefix ? `${prefix}${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as any;
      const hasValue = '_value' in o;
      const isObj = o._object === true || (!hasValue && Object.keys(o).some(x => !x.startsWith('_')));
      if (hasValue || o._type || o._timestamp) {
        out.push({ path, value: pv(v), type: o._type, timestamp: o._timestamp, writable: o._writable, object: o._object });
      }
      if (isObj) {
        const nextPrefix = path.endsWith('.') ? path : path + '.';
        flattenParams(v, nextPrefix, out, depth + 1);
      }
    } else {
      out.push({ path, value: v });
    }
  }
  return out;
}

export function getPath(obj: any, path: string): any {
  if (!obj) return undefined;
  const parts = path.replace(/\.$/, '').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function collectInstances(parent: any): Array<{ key: string; node: any }> {
  if (!parent || typeof parent !== 'object') return [];
  return Object.entries(parent)
    .filter(([k, v]) => /^\d+$/.test(k) && v && typeof v === 'object')
    .map(([k, v]) => ({ key: k, node: v }));
}

function bytesHuman(n: any) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return String(n ?? '-');
  const units = ['B','KB','MB','GB','TB'];
  let i = 0, v = Math.abs(x);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(2)} ${units[i]}`;
}

export function buildDiagnostics(device: any) {
  const flat = flattenParams(device);
  const hosts: any[] = [];
  const hostPaths = ['InternetGatewayDevice.LANDevice.1.Hosts.Host', 'Device.Hosts.Host'];
  for (const hp of hostPaths) {
    for (const { key, node } of collectInstances(getPath(device, hp))) {
      const row = {
        index: key,
        hostname: pv(node?.HostName) ?? pv(node?.PhysAddress) ?? null,
        ip: pv(node?.IPAddress) ?? null,
        mac: pv(node?.MACAddress) ?? pv(node?.PhysAddress) ?? null,
        interface: pv(node?.InterfaceType) ?? pv(node?.Layer1Interface) ?? null,
        active: pv(node?.Active),
        address_source: pv(node?.AddressSource) ?? null,
        source_path: hp,
      };
      if (row.ip || row.mac || row.hostname) hosts.push(row);
    }
  }

  const wifiAssociations: any[] = [];
  // TR-098 AssociatedDevice under each WLANConfiguration instance
  for (const { key, node } of collectInstances(getPath(device, 'InternetGatewayDevice.LANDevice.1.WLANConfiguration'))) {
    const ssid = pv(node?.SSID);
    const enabled = pv(node?.Enable);
    for (const { key: ak, node: an } of collectInstances(node?.AssociatedDevice)) {
      wifiAssociations.push({
        wlan_index: key, ssid, radio_enabled: enabled,
        mac: pv(an?.AssociatedDeviceMACAddress) ?? pv(an?.MACAddress) ?? null,
        ip: pv(an?.AssociatedDeviceIPAddress) ?? null,
        authenticated: pv(an?.AssociatedDeviceAuthenticationState),
        signal_strength: pv(an?.X_TP_RSSI) ?? pv(an?.SignalStrength) ?? pv(an?.RSSI) ?? null,
        tx_rate: pv(an?.LastDataTransmitRate) ?? pv(an?.X_TP_LastDataTransmitRate) ?? null,
        rx_rate: pv(an?.LastDataDownlinkRate) ?? null,
        source_path: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${key}.AssociatedDevice.${ak}`,
      });
    }
  }
  // TR-181-ish fallback
  for (const { key, node } of collectInstances(getPath(device, 'Device.WiFi.AccessPoint'))) {
    const ssid = pv(node?.SSIDReference) ?? pv(node?.SSID);
    for (const { key: ak, node: an } of collectInstances(node?.AssociatedDevice)) {
      wifiAssociations.push({ ap_index: key, ssid, mac: pv(an?.MACAddress), signal_strength: pv(an?.SignalStrength), tx_rate: pv(an?.LastDataDownlinkRate), rx_rate: pv(an?.LastDataUplinkRate), source_path: `Device.WiFi.AccessPoint.${key}.AssociatedDevice.${ak}` });
    }
  }

  const interfaces: any[] = [];
  const wanPpp = getPath(device, 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1');
  const wanIp = getPath(device, 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1');
  const wanCommon = getPath(device, 'InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig');
  const pickStats = (node: any, name: string, source_path: string) => {
    if (!node) return;
    const stats = node.Stats || node;
    const row = {
      name,
      source_path,
      connection_status: pv(node.ConnectionStatus) ?? pv(node.Status) ?? null,
      external_ip: pv(node.ExternalIPAddress) ?? null,
      uptime: pv(node.Uptime) ?? null,
      bytes_sent: pv(stats.BytesSent) ?? pv(stats.X_TP_BytesSent) ?? pv(stats.EthernetBytesSent) ?? null,
      bytes_received: pv(stats.BytesReceived) ?? pv(stats.X_TP_BytesReceived) ?? pv(stats.EthernetBytesReceived) ?? null,
      packets_sent: pv(stats.PacketsSent) ?? pv(stats.EthernetPacketsSent) ?? null,
      packets_received: pv(stats.PacketsReceived) ?? pv(stats.EthernetPacketsReceived) ?? null,
      errors_sent: pv(stats.X_TP_ErrorsSent) ?? pv(stats.ErrorsSent) ?? null,
      errors_received: pv(stats.X_TP_ErrorsReceived) ?? pv(stats.ErrorsReceived) ?? null,
      timestamp: (stats.BytesSent?._timestamp || stats.BytesReceived?._timestamp || node.ConnectionStatus?._timestamp || null),
    };
    if (row.bytes_sent != null || row.bytes_received != null || row.connection_status || row.external_ip) interfaces.push(row);
  };
  pickStats(wanPpp, 'WAN PPP', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1');
  pickStats(wanIp, 'WAN IP', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1');
  if (wanCommon) pickStats(wanCommon, 'WAN Common', 'InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig');

  // WLAN radio/config info
  const wifiRadios: any[] = [];
  for (const { key, node } of collectInstances(getPath(device, 'InternetGatewayDevice.LANDevice.1.WLANConfiguration'))) {
    wifiRadios.push({
      index: key,
      ssid: pv(node?.SSID),
      enabled: pv(node?.Enable),
      channel: pv(node?.Channel),
      auto_channel: pv(node?.AutoChannelEnable),
      standard: pv(node?.Standard),
      bssid: pv(node?.BSSID),
      beacon_type: pv(node?.BeaconType),
      total_associations: pv(node?.TotalAssociations) ?? pv(node?.AssociatedDeviceNumberOfEntries),
      transmit_power: pv(node?.TransmitPower) ?? pv(node?.X_TP_TransmitPower),
      stats: {
        bytes_sent: pv(node?.Stats?.BytesSent),
        bytes_received: pv(node?.Stats?.BytesReceived),
        errors_sent: pv(node?.Stats?.ErrorsSent),
        errors_received: pv(node?.Stats?.ErrorsReceived),
      },
      source_path: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${key}`,
    });
  }

  const issues: string[] = [];
  const activeHosts = hosts.filter(h => h.active === true || h.active === 1 || String(h.active).toLowerCase() === 'true' || h.ip);
  if (!hosts.length) issues.push('No host/client entries found in cached parameters. Run a diagnostic refresh (Hosts/Wi-Fi/Stats) and fetch again after the CPE responds.');
  for (const it of interfaces) {
    if (it.connection_status && !/connected|up/i.test(String(it.connection_status))) issues.push(`${it.name} status: ${it.connection_status}`);
    if (Number(it.errors_received || 0) > 1000 || Number(it.errors_sent || 0) > 1000) issues.push(`${it.name} has elevated error counters (RX ${it.errors_received || 0}, TX ${it.errors_sent || 0})`);
  }
  for (const w of wifiRadios) {
    if (w.enabled === false || String(w.enabled).toLowerCase() === 'false') issues.push(`Wi-Fi radio ${w.index} (${w.ssid || 'SSID'}) is disabled`);
  }

  return {
    generated_at: new Date().toISOString(),
    counts: { hosts: hosts.length, active_hosts: activeHosts.length, wifi_associations: wifiAssociations.length, wifi_radios: wifiRadios.length },
    hosts,
    wifi_associations: wifiAssociations,
    wifi_radios: wifiRadios,
    interfaces,
    issues,
    parameter_count: flat.length,
  };
}

export function qs(params: Record<string, any>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    // connection_request must be sent even when empty — GenieACS triggers the
    // CPE connection on presence (url.searchParams.has('connection_request')).
    if (v == null || (v === '' && k !== 'connection_request')) continue;
    u.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function pickDeviceSummary(d: any) {
  const g = (path: string) => {
    try { return path.split('.').reduce((o: any, k) => (o && o[k] != null ? o[k] : undefined), d); } catch { return undefined; }
  };
  const val = (x: any) => (x && typeof x === 'object' && '_value' in x ? x._value : x);
  const id = d?._id || d?.id || '';
  const serial = val(g('_deviceId._SerialNumber')) || val(g('DeviceID.SerialNumber')) || val(g('InternetGatewayDevice.DeviceInfo.SerialNumber')) || val(g('Device.DeviceInfo.SerialNumber'));
  const oui = val(g('_deviceId._OUI')) || val(g('DeviceID.OUI'));
  const productClass = val(g('_deviceId._ProductClass')) || val(g('DeviceID.ProductClass'));
  const manufacturer = val(g('_deviceId._Manufacturer')) || val(g('DeviceID.Manufacturer')) || val(g('InternetGatewayDevice.DeviceInfo.Manufacturer')) || val(g('Device.DeviceInfo.Manufacturer'));
  const modelName = val(g('InternetGatewayDevice.DeviceInfo.ModelName')) || val(g('Device.DeviceInfo.ModelName')) || productClass;
  const software = val(g('InternetGatewayDevice.DeviceInfo.SoftwareVersion')) || val(g('Device.DeviceInfo.SoftwareVersion'));
  const hardware = val(g('InternetGatewayDevice.DeviceInfo.HardwareVersion')) || val(g('Device.DeviceInfo.HardwareVersion'));
  const ip = val(g('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress')) || val(g('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress')) || val(g('Device.IP.Interface.1.IPv4Address.1.IPAddress'));
  const crUrl = val(g('InternetGatewayDevice.ManagementServer.ConnectionRequestURL')) || val(g('Device.ManagementServer.ConnectionRequestURL'));
  const lastInform = val(g('_lastInform')) || d?._lastInform || null;
  const tags = Array.isArray(d?._tags) ? d._tags : [];
  return {
    id,
    serial_number: serial ?? null,
    oui: oui ?? null,
    product_class: productClass ?? null,
    manufacturer: manufacturer ?? null,
    model_name: modelName ?? null,
    software_version: software ?? null,
    hardware_version: hardware ?? null,
    ip_address: ip ?? null,
    connection_request_url: crUrl ?? null,
    last_inform_at: lastInform ?? null,
    tags,
  };
}

async function logAction(args: { device_id: string; action: string; task_name?: string; task_id?: string; payload?: any; result?: any; status?: string; error_message?: string; created_by?: string }) {
  try {
    const dev = await pool.query('SELECT id FROM acs_devices WHERE genieacs_id = $1 LIMIT 1', [args.device_id]).catch(()=>({rows:[] as any[]}));
    await pool.query(
      `INSERT INTO acs_device_actions(acs_device_id, device_id, action, task_name, task_id, payload, result, status, error_message, created_by, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,now(),now())`,
      [dev.rows[0]?.id || null, args.device_id, args.action, args.task_name || null, args.task_id || null, JSON.stringify(args.payload || {}), JSON.stringify(args.result || {}), args.status || 'QUEUED', args.error_message || null, args.created_by || null]
    );
  } catch {}
}

export async function upsertAcsDevice(summary: any) {
  if (!summary?.id) return;
  try {
    await pool.query(
      `INSERT INTO acs_devices(genieacs_id, serial_number, oui, product_class, manufacturer, model_name, software_version, hardware_version, connection_request_url, ip_address, last_inform_at, tags, raw_summary, status, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,CASE WHEN $11::timestamptz IS NOT NULL THEN 'ONLINE' ELSE 'UNKNOWN' END, now())
       ON CONFLICT (genieacs_id) DO UPDATE SET
         serial_number=COALESCE(EXCLUDED.serial_number, acs_devices.serial_number),
         oui=COALESCE(EXCLUDED.oui, acs_devices.oui),
         product_class=COALESCE(EXCLUDED.product_class, acs_devices.product_class),
         manufacturer=COALESCE(EXCLUDED.manufacturer, acs_devices.manufacturer),
         model_name=COALESCE(EXCLUDED.model_name, acs_devices.model_name),
         software_version=COALESCE(EXCLUDED.software_version, acs_devices.software_version),
         hardware_version=COALESCE(EXCLUDED.hardware_version, acs_devices.hardware_version),
         connection_request_url=COALESCE(EXCLUDED.connection_request_url, acs_devices.connection_request_url),
         ip_address=COALESCE(EXCLUDED.ip_address, acs_devices.ip_address),
         last_inform_at=COALESCE(EXCLUDED.last_inform_at, acs_devices.last_inform_at),
         tags=EXCLUDED.tags,
         raw_summary=EXCLUDED.raw_summary,
         status=CASE WHEN EXCLUDED.last_inform_at IS NOT NULL AND EXCLUDED.last_inform_at > now() - interval '24 hours' THEN 'ONLINE'
             WHEN acs_devices.last_inform_at IS NOT NULL THEN 'STALE'
             ELSE 'UNKNOWN' END,
         updated_at=now()`,
      [summary.id, summary.serial_number, summary.oui, summary.product_class, summary.manufacturer, summary.model_name, summary.software_version, summary.hardware_version, summary.connection_request_url, summary.ip_address, summary.last_inform_at, JSON.stringify(summary.tags || []), JSON.stringify(summary)]
    );
  } catch {}
}

router.get('/status', asyncHandler(async (_req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.json({ ok: true, configured: false, baseUrl: null, reachable: false, source: cfg.source });
  try {
    // lightweight probe
    await acsFetch('/devices/?limit=1&projection=_id');
    res.json({ ok: true, configured: true, baseUrl: cfg.base, reachable: true, source: cfg.source });
  } catch (e: any) {
    res.json({ ok: false, configured: true, baseUrl: cfg.base, reachable: false, source: cfg.source, message: e.message });
  }
}));

router.get('/devices', asyncHandler(async (req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.json({ ok: true, configured: false, data: [], message: 'GenieACS not configured. Set it in Settings > ACS / TR-069 or via GENIEACS_URL env.' });
  let queryObj: any = {};
  if (req.query.query) {
    try { queryObj = JSON.parse(String(req.query.query)); } catch { return res.status(400).json({ ok: false, configured: true, message: 'Invalid query JSON' }); }
  }
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
  const projection = req.query.projection ? String(req.query.projection) : undefined;
  try {
    const params: any = { query: queryObj, limit };
    if (projection) params.projection = projection;
    const data = await acsFetch(`/devices/${qs(params)}`);
    const arr = Array.isArray(data) ? data : (data?.data || []);
    const summaries = arr.map(pickDeviceSummary);
    // best-effort cache/upsert
    for (const s of summaries) await upsertAcsDevice(s);
    // merge local mapping info
    const ids = summaries.map((s: any) => s.id).filter(Boolean);
    let local: any[] = [];
    if (ids.length) {
      const lr = await pool.query(
        `SELECT d.*, s.full_name AS subscriber_name, s.client_code, s.username AS subscriber_username
         FROM acs_devices d LEFT JOIN subscribers s ON s.id = d.subscriber_id
         WHERE d.genieacs_id = ANY($1::text[])`, [ids]
      ).catch(()=>({rows:[] as any[]}));
      local = lr.rows || [];
    }
    const localBy = new Map(local.map((r: any) => [r.genieacs_id, r]));
    const merged = summaries.map((s: any) => ({ ...s, local: localBy.get(s.id) || null }));
    res.json({ ok: true, configured: true, data: merged, raw_count: arr.length });
  } catch (e: any) { res.status(e.status || 502).json({ ok: false, configured: true, message: e.message }); }
}));

router.get('/devices/:id', asyncHandler(async (req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.status(501).json({ ok: false, configured: false, message: 'GenieACS not configured. Set it in Settings > ACS / TR-069 or via GENIEACS_URL env.' });
  const id = String(req.params.id);
  try {
    const data = await acsFetch(`/devices/${qs({ query: { _id: id } })}`);
    const device = Array.isArray(data) ? data[0] : data;
    if (!device) return res.status(404).json({ ok: false, message: 'Device not found in ACS' });
    const summary = pickDeviceSummary(device);
    await upsertAcsDevice(summary);
    const lr = await pool.query(
      `SELECT d.*, s.full_name AS subscriber_name, s.client_code, s.username AS subscriber_username
       FROM acs_devices d LEFT JOIN subscribers s ON s.id = d.subscriber_id WHERE d.genieacs_id=$1`, [id]
    ).catch(()=>({rows:[] as any[]}));
    const diagnostics = buildDiagnostics(device);
    const includeFlat = String(req.query.flat || '') === '1' || String(req.query.flat || '') === 'true';
    res.json({ ok: true, configured: true, data: device, summary, local: lr.rows[0] || null, diagnostics, flat_params: includeFlat ? flattenParams(device) : undefined });
  } catch (e: any) { res.status(e.status || 502).json({ ok: false, configured: true, message: e.message }); }
}));

router.get('/devices/:id/diagnostics', asyncHandler(async (req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.status(501).json({ ok: false, configured: false, message: 'GenieACS not configured' });
  const id = String(req.params.id);
  const data = await acsFetch(`/devices/${qs({ query: { _id: id } })}`);
  const device = Array.isArray(data) ? data[0] : data;
  if (!device) return res.status(404).json({ ok: false, message: 'Device not found in ACS' });
  res.json({ ok: true, diagnostics: buildDiagnostics(device), summary: pickDeviceSummary(device) });
}));

router.get('/devices/:id/parameters', asyncHandler(async (req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.status(501).json({ ok: false, configured: false, message: 'GenieACS not configured' });
  const id = String(req.params.id);
  const search = String(req.query.search || '').toLowerCase();
  const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit || '2000'), 10) || 2000));
  const data = await acsFetch(`/devices/${qs({ query: { _id: id } })}`);
  const device = Array.isArray(data) ? data[0] : data;
  if (!device) return res.status(404).json({ ok: false, message: 'Device not found in ACS' });
  let flat = flattenParams(device);
  if (search) flat = flat.filter(p => p.path.toLowerCase().includes(search) || String(p.value ?? '').toLowerCase().includes(search));
  res.json({ ok: true, total: flat.length, data: flat.slice(0, limit) });
}));

router.post('/devices/:id/diagnostic-refresh', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const profile = String(req.body?.profile || 'standard'); // basic|standard|full|auto
  const custom = Array.isArray(req.body?.parameterNames) ? req.body.parameterNames.map(String) : [];
  const sets: Record<string, string[]> = {
    basic: [
      'InternetGatewayDevice.DeviceInfo.',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.',
      'Device.DeviceInfo.',
    ],
    standard: [
      'InternetGatewayDevice.DeviceInfo.',
      'InternetGatewayDevice.LANDevice.1.Hosts.',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.',
      'InternetGatewayDevice.WANDevice.1.WANCommonInterfaceConfig.',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.',
      'Device.Hosts.',
      'Device.WiFi.',
      'Device.IP.',
      'Device.Ethernet.',
    ],
    full: [
      'InternetGatewayDevice.',
      'Device.',
    ],
    auto: [
      'InternetGatewayDevice.',
      'Device.',
    ],
  };
  const names = custom.length ? custom : (sets[profile] || sets.standard);
  const tasks: any[] = [];
  let connectionRequested = false;
  for (const name of names) {
    const body = name.endsWith('.') ? { name: 'refreshObject', objectName: name } : { name: 'getParameterValues', parameterNames: [name] };
    try {
      const q = connectionRequested ? '' : qs({ connection_request: '' });
      const t = await acsFetch(`/devices/${encodeURIComponent(id)}/tasks${q}`, { method: 'POST', body: JSON.stringify(body) });
      if (!connectionRequested) connectionRequested = true;
      tasks.push({ ok: true, task: t, request: body });
    } catch (e: any) {
      tasks.push({ ok: false, error: e.message, request: body });
    }
  }
  await logAction({ device_id: id, action: 'DIAGNOSTIC_REFRESH', task_name: profile, payload: { profile, parameterNames: names }, result: { tasks: tasks.length, ok: tasks.filter(t=>t.ok).length }, status: tasks.some(t=>t.ok) ? 'QUEUED' : 'FAILED', created_by: (req as any).user?.id });
  res.json({ ok: true, queued: tasks.filter(t=>t.ok).length, failed: tasks.filter(t=>!t.ok).length, tasks, note: 'Tasks queued in GenieACS. Wait for the CPE to respond (inform/connection request), then reload device diagnostics/parameters to see updated live data.' });
}));

router.post('/devices/:id/discover-parameters', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const paths = Array.isArray(req.body?.parameterPaths) && req.body.parameterPaths.length
    ? req.body.parameterPaths.map(String)
    : ['InternetGatewayDevice.', 'Device.'];
  const nextLevel = req.body?.nextLevel === true;
  const tasks: any[] = [];
  let connectionRequested = false;
  for (const parameterPath of paths) {
    const body: any = { name: 'getParameterNames', parameterPath };
    if (nextLevel) body.nextLevel = true;
    try {
      const q = connectionRequested ? '' : qs({ connection_request: '' });
      const t = await acsFetch(`/devices/${encodeURIComponent(id)}/tasks${q}`, { method: 'POST', body: JSON.stringify(body) });
      if (!connectionRequested) connectionRequested = true;
      tasks.push({ ok: true, task: t, request: body });
    } catch (e: any) {
      tasks.push({ ok: false, error: e.message, request: body });
    }
  }
  await logAction({ device_id: id, action: 'DISCOVER_PARAMETERS', task_name: 'getParameterNames', payload: { parameterPaths: paths, nextLevel }, result: { tasks: tasks.length, ok: tasks.filter(t=>t.ok).length }, status: tasks.some(t=>t.ok) ? 'QUEUED' : 'FAILED', created_by: (req as any).user?.id });
  res.json({ ok: true, queued: tasks.filter(t=>t.ok).length, failed: tasks.filter(t=>!t.ok).length, tasks, note: 'Parameter discovery queued. After the CPE responds, reload Full Output/Diagnostics to see discovered parameters and supported paths.' });
}));

router.post('/devices/:id/refresh', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const objectName = String(req.body?.objectName || '');
  // Prefer refreshObject for broad roots (InternetGatewayDevice. by default).
  const taskBody = objectName ? { name: 'refreshObject', objectName } : { name: 'refreshObject', objectName: String(req.body?.root || 'InternetGatewayDevice.') };
  try {
    const data = await acsFetch(`/devices/${encodeURIComponent(id)}/tasks${qs({ connection_request: '' })}`, { method: 'POST', body: JSON.stringify(taskBody) });
    await logAction({ device_id: id, action: 'REFRESH', task_name: taskBody.name, task_id: data?._id, payload: taskBody, result: data, status: 'QUEUED', created_by: (req as any).user?.id });
    res.json({ ok: true, task: data });
  } catch (e: any) {
    await logAction({ device_id: id, action: 'REFRESH', task_name: taskBody.name, payload: taskBody, status: 'FAILED', error_message: e.message, created_by: (req as any).user?.id });
    res.status(e.status || 502).json({ ok: false, message: e.message });
  }
}));

router.post('/devices/:id/reboot', requireRole(['SUPER_ADMIN','NOC_ENGINEER']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  try {
    const data = await acsFetch(`/devices/${encodeURIComponent(id)}/tasks${qs({ connection_request: '' })}`, { method: 'POST', body: JSON.stringify({ name: 'reboot' }) });
    await logAction({ device_id: id, action: 'REBOOT', task_name: 'reboot', task_id: data?._id, payload: { name: 'reboot' }, result: data, status: 'QUEUED', created_by: (req as any).user?.id });
    res.json({ ok: true, task: data });
  } catch (e: any) {
    await logAction({ device_id: id, action: 'REBOOT', task_name: 'reboot', status: 'FAILED', error_message: e.message, created_by: (req as any).user?.id });
    res.status(e.status || 502).json({ ok: false, message: e.message });
  }
}));

router.post('/devices/:id/factory-reset', requireRole(['SUPER_ADMIN']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  if (String(req.body?.confirm || '') !== 'FACTORY_RESET') return res.status(400).json({ ok: false, message: 'Confirmation required: set confirm="FACTORY_RESET"' });
  try {
    const data = await acsFetch(`/devices/${encodeURIComponent(id)}/tasks${qs({ connection_request: '' })}`, { method: 'POST', body: JSON.stringify({ name: 'factoryReset' }) });
    await logAction({ device_id: id, action: 'FACTORY_RESET', task_name: 'factoryReset', task_id: data?._id, result: data, status: 'QUEUED', created_by: (req as any).user?.id });
    res.json({ ok: true, task: data });
  } catch (e: any) {
    await logAction({ device_id: id, action: 'FACTORY_RESET', task_name: 'factoryReset', status: 'FAILED', error_message: e.message, created_by: (req as any).user?.id });
    res.status(e.status || 502).json({ ok: false, message: e.message });
  }
}));

router.post('/devices/:id/get-params', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const names = Array.isArray(req.body?.parameterNames) ? req.body.parameterNames : (req.body?.parameterName ? [req.body.parameterName] : []);
  if (!names.length) return res.status(400).json({ ok: false, message: 'parameterNames[] or parameterName required' });
  try {
    const data = await acsFetch(`/devices/${encodeURIComponent(id)}/tasks${qs({ connection_request: '' })}`, { method: 'POST', body: JSON.stringify({ name: 'getParameterValues', parameterNames: names }) });
    await logAction({ device_id: id, action: 'GET_PARAMS', task_name: 'getParameterValues', task_id: data?._id, payload: { parameterNames: names }, result: data, status: 'QUEUED', created_by: (req as any).user?.id });
    res.json({ ok: true, task: data });
  } catch (e: any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

router.post('/devices/:id/set-params', requireRole(['SUPER_ADMIN','NOC_ENGINEER']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  let parameterValues = req.body?.parameterValues;
  if (!Array.isArray(parameterValues) || !parameterValues.length) return res.status(400).json({ ok: false, message: 'parameterValues is required (e.g. [["Path", "value", "xsd:string"]])' });
  parameterValues = parameterValues.map((p: any) => Array.isArray(p) ? [String(p[0]), p[1] == null ? '' : String(p[1]), String(p[2] || 'xsd:string')] : p);
  try {
    const data = await acsFetch(`/devices/${encodeURIComponent(id)}/tasks${qs({ connection_request: '' })}`, { method: 'POST', body: JSON.stringify({ name: 'setParameterValues', parameterValues }) });
    await logAction({ device_id: id, action: 'SET_PARAMS', task_name: 'setParameterValues', task_id: data?._id, payload: { parameterValues: parameterValues.map((p:any)=>[p[0], String(p[0]).toLowerCase().includes('pass') ? '***' : p[1], p[2]]) }, result: data, status: 'QUEUED', created_by: (req as any).user?.id });
    res.json({ ok: true, task: data });
  } catch (e: any) {
    await logAction({ device_id: id, action: 'SET_PARAMS', task_name: 'setParameterValues', payload: { parameterValues }, status: 'FAILED', error_message: e.message, created_by: (req as any).user?.id });
    res.status(e.status || 502).json({ ok: false, message: e.message });
  }
}));

router.post('/devices/:id/add-object', requireRole(['SUPER_ADMIN','NOC_ENGINEER']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const objectName = String(req.body?.objectName || '');
  if (!objectName) return res.status(400).json({ ok: false, message: 'objectName is required' });
  try {
    const data = await acsFetch(`/devices/${encodeURIComponent(id)}/tasks${qs({ connection_request: '' })}`, { method: 'POST', body: JSON.stringify({ name: 'addObject', objectName }) });
    await logAction({ device_id: id, action: 'ADD_OBJECT', task_name: 'addObject', task_id: data?._id, payload: { objectName }, result: data, status: 'QUEUED', created_by: (req as any).user?.id });
    res.json({ ok: true, task: data });
  } catch (e: any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

router.post('/devices/:id/delete-object', requireRole(['SUPER_ADMIN','NOC_ENGINEER']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const objectName = String(req.body?.objectName || '');
  if (!objectName) return res.status(400).json({ ok: false, message: 'objectName is required' });
  try {
    const data = await acsFetch(`/devices/${encodeURIComponent(id)}/tasks${qs({ connection_request: '' })}`, { method: 'POST', body: JSON.stringify({ name: 'deleteObject', objectName }) });
    await logAction({ device_id: id, action: 'DELETE_OBJECT', task_name: 'deleteObject', task_id: data?._id, payload: { objectName }, result: data, status: 'QUEUED', created_by: (req as any).user?.id });
    res.json({ ok: true, task: data });
  } catch (e: any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

// Wi-Fi convenience (backward-compatible)
router.post('/wifi', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const deviceId = String(b.device_id || b.deviceId || '').trim();
  const ssid = b.ssid;
  const password = b.password;
  if (!deviceId) return res.status(400).json({ ok: false, message: 'device_id is required' });
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.status(501).json({ ok: false, configured: false, message: 'GenieACS/TR-069 ACS not configured. Set GenieACS URL in Settings > ACS / TR-069 or via GENIEACS_URL env.' });
  const params: any[] = [];
  const ssidPath = b.ssid_path || 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID';
  const passPath = b.password_path || b.key_path || 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase';
  if (ssid != null && ssid !== '') params.push([ssidPath, String(ssid), 'xsd:string']);
  if (password != null && password !== '') params.push([passPath, String(password), 'xsd:string']);
  if (!params.length) return res.status(400).json({ ok: false, message: 'ssid and/or password required' });
  try {
    const task = { name: 'setParameterValues', parameterValues: params };
    const data = await acsFetch(`/devices/${encodeURIComponent(deviceId)}/tasks${qs({ connection_request: '' })}`, { method: 'POST', body: JSON.stringify(task) });
    await logAction({ device_id: deviceId, action: 'WIFI_UPDATE', task_name: 'setParameterValues', task_id: data?._id, payload: { parameterValues: params.map(p => [p[0], String(p[0]).toLowerCase().includes('pass') ? '***' : p[1], p[2]]) }, result: data, status: 'QUEUED', created_by: (req as any).user?.id });
    res.json({ ok: true, device_id: deviceId, task: data });
  } catch (e: any) {
    await logAction({ device_id: deviceId, action: 'WIFI_UPDATE', task_name: 'setParameterValues', status: 'FAILED', error_message: e.message, created_by: (req as any).user?.id });
    res.status(e.status || 502).json({ ok: false, message: e.message });
  }
}));

router.get('/devices/:id/tasks', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.status(501).json({ ok: false, configured: false, message: 'GenieACS not configured' });
  try {
    const data = await acsFetch(`/tasks/${qs({ query: { device: id } })}`);
    res.json({ ok: true, data: Array.isArray(data) ? data : [] });
  } catch (e: any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

router.delete('/tasks/:taskId', requireRole(['SUPER_ADMIN','NOC_ENGINEER']), asyncHandler(async (req, res) => {
  const taskId = String(req.params.taskId);
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.status(501).json({ ok: false, configured: false, message: 'GenieACS not configured' });
  try {
    const data = await acsFetch(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    res.json({ ok: true, data });
  } catch (e: any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

router.get('/faults', asyncHandler(async (req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.json({ ok: true, configured: false, data: [] });
  let queryObj: any = {};
  if (req.query.query) { try { queryObj = JSON.parse(String(req.query.query)); } catch { queryObj = {}; } }
  if (req.query.device) queryObj.device = String(req.query.device);
  try {
    const data = await acsFetch(`/faults/${qs({ query: queryObj })}`);
    res.json({ ok: true, data: Array.isArray(data) ? data : [] });
  } catch (e: any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

router.delete('/faults/:id', requireRole(['SUPER_ADMIN','NOC_ENGINEER']), asyncHandler(async (req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.status(501).json({ ok: false, configured: false, message: 'GenieACS not configured' });
  const id = String(req.params.id);
  try { const data = await acsFetch(`/faults/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(()=>({})); res.json({ ok: true, data }); }
  catch (e:any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

router.get('/presets', asyncHandler(async (_req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.json({ ok: true, configured: false, data: [] });
  try { const data = await acsFetch('/presets/'); res.json({ ok: true, data: Array.isArray(data) ? data : [] }); }
  catch (e:any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

router.get('/provisions', asyncHandler(async (_req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.json({ ok: true, configured: false, data: [] });
  try { const data = await acsFetch('/provisions/'); res.json({ ok: true, data: Array.isArray(data) ? data : [] }); }
  catch (e:any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

router.get('/files', asyncHandler(async (_req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.json({ ok: true, configured: false, data: [] });
  try { const data = await acsFetch('/files/'); res.json({ ok: true, data: Array.isArray(data) ? data : [] }); }
  catch (e:any) { res.status(e.status || 502).json({ ok: false, message: e.message }); }
}));

router.get('/devices/:id/local', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const actions = await pool.query('SELECT * FROM acs_device_actions WHERE device_id=$1 ORDER BY created_at DESC LIMIT 100', [id]).catch(()=>({rows:[] as any[]}));
  const local = await pool.query(`SELECT d.*, s.full_name AS subscriber_name, s.client_code FROM acs_devices d LEFT JOIN subscribers s ON s.id=d.subscriber_id WHERE d.genieacs_id=$1`, [id]).catch(()=>({rows:[] as any[]}));
  res.json({ ok: true, local: local.rows[0] || null, actions: actions.rows || [] });
}));

router.get('/actions', asyncHandler(async (req, res) => {
  const deviceId = req.query.device_id ? String(req.query.device_id) : null;
  const r = deviceId
    ? await pool.query('SELECT * FROM acs_device_actions WHERE device_id=$1 ORDER BY created_at DESC LIMIT 200', [deviceId]).catch(()=>({rows:[] as any[]}))
    : await pool.query('SELECT * FROM acs_device_actions ORDER BY created_at DESC LIMIT 200').catch(()=>({rows:[] as any[]}));
  res.json({ ok: true, data: r.rows || [] });
}));

router.post('/sync', requireRole(['SUPER_ADMIN','NOC_ENGINEER']), asyncHandler(async (_req, res) => {
  const cfg = await getAcsConfig();
  if (!cfg.configured) return res.status(501).json({ ok: false, configured: false, message: 'GenieACS not configured. Set it in Settings > ACS / TR-069 or via GENIEACS_URL env.' });
  const data = await acsFetch(`/devices/${qs({ limit: 500, projection: '_id,_deviceId,_lastInform,InternetGatewayDevice.DeviceInfo,Device.DeviceInfo,InternetGatewayDevice.ManagementServer,Device.ManagementServer,_tags' })}`);
  const arr = Array.isArray(data) ? data : [];
  let count = 0;
  for (const d of arr) { const s = pickDeviceSummary(d); await upsertAcsDevice(s); count++; }
  res.json({ ok: true, synced: count });
}));

/** Customer-portal helpers. These intentionally expose only status and Wi-Fi
 *  updates for devices explicitly linked to the authenticated subscriber. */
export async function getPortalAcsStatus(subscriberId: string) {
  const cfg = await getAcsConfig();
  const devices = await pool.query(
    `SELECT genieacs_id, serial_number, manufacturer, model_name, status, last_inform_at
     FROM acs_devices WHERE subscriber_id=$1 ORDER BY updated_at DESC LIMIT 10`,
    [subscriberId],
  ).catch(() => ({ rows: [] as any[] }));
  if (!cfg.configured) return { ok: true, configured: false, reachable: false, devices: devices.rows || [] };
  try {
    await acsFetch('/devices/?limit=1&projection=_id');
    return { ok: true, configured: true, reachable: true, devices: devices.rows || [] };
  } catch (e: any) {
    return { ok: true, configured: true, reachable: false, devices: devices.rows || [], message: e?.message };
  }
}

export async function updatePortalSubscriberWifi(subscriberId: string, input: any) {
  const deviceId = String(input?.device_id || input?.deviceId || '').trim();
  if (!deviceId) {
    const err: any = new Error('device_id is required'); err.status = 400; throw err;
  }
  const owned = await pool.query('SELECT 1 FROM acs_devices WHERE genieacs_id=$1 AND subscriber_id=$2', [deviceId, subscriberId]);
  if (!owned.rows[0]) {
    const err: any = new Error('This device is not linked to your account'); err.status = 403; throw err;
  }
  const cfg = await getAcsConfig();
  if (!cfg.configured) {
    const err: any = new Error('GenieACS/TR-069 is not configured'); err.status = 501; throw err;
  }
  const params: any[] = [];
  const ssid = input?.ssid;
  const password = input?.password;
  if (ssid != null && String(ssid).trim()) {
    const value = String(ssid).trim();
    if (value.length > 32) { const err: any = new Error('SSID is too long'); err.status = 400; throw err; }
    params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', value, 'xsd:string']);
  }
  if (password != null && String(password)) {
    const value = String(password);
    if (value.length < 8 || value.length > 63) { const err: any = new Error('Wi-Fi password must be 8-63 characters'); err.status = 400; throw err; }
    params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase', value, 'xsd:string']);
  }
  if (!params.length) {
    const err: any = new Error('ssid and/or password required'); err.status = 400; throw err;
  }
  try {
    const task = { name: 'setParameterValues', parameterValues: params };
    const data = await acsFetch(`/devices/${encodeURIComponent(deviceId)}/tasks${qs({ connection_request: '' })}`, { method: 'POST', body: JSON.stringify(task) });
    await logAction({
      device_id: deviceId,
      action: 'WIFI_UPDATE',
      task_name: 'setParameterValues',
      task_id: data?._id,
      payload: { parameterValues: params.map((p) => [p[0], String(p[0]).toLowerCase().includes('pass') ? '***' : p[1], p[2]]) },
      result: data,
      status: 'QUEUED',
      created_by: null,
    });
    return { ok: true, device_id: deviceId, task: data };
  } catch (e: any) {
    await logAction({ device_id: deviceId, action: 'WIFI_UPDATE', task_name: 'setParameterValues', status: 'FAILED', error_message: e?.message, created_by: null }).catch(() => {});
    throw e;
  }
}

export default router;
