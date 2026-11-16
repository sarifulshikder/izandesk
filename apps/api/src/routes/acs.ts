import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { getCached } from '../integrations/settings';

const router: Router = Router();

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

function qs(params: Record<string, any>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    u.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

function pickDeviceSummary(d: any) {
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

async function upsertAcsDevice(summary: any) {
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
         status=CASE WHEN EXCLUDED.last_inform_at IS NOT NULL THEN 'ONLINE' ELSE acs_devices.status END,
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
    res.json({ ok: true, configured: true, data: device, summary, local: lr.rows[0] || null });
  } catch (e: any) { res.status(e.status || 502).json({ ok: false, configured: true, message: e.message }); }
}));

router.post('/devices/:id/refresh', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const objectName = String(req.body?.objectName || '');
  const task = objectName ? { name: 'refreshObject', objectName } : { name: 'getParameterValues', parameterNames: [req.body?.parameterName || ''] .filter(Boolean) };
  // If no specific param given, refresh common roots via getParameterValues on root-ish paths can be heavy; prefer refreshObject for InternetGatewayDevice.
  const taskBody = objectName ? { name: 'refreshObject', objectName } : { name: 'refreshObject', objectName: req.body?.root || 'InternetGatewayDevice.' };
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
    const data = await acsFetch(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }).catch(() => ({}));
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

// Local mapping/linking
router.post('/devices/:id/link', requireRole(['SUPER_ADMIN','NOC_ENGINEER','BILLING_OPERATOR']), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const subscriberId = req.body?.subscriber_id || null;
  await pool.query(
    `INSERT INTO acs_devices(genieacs_id, subscriber_id, updated_at) VALUES($1,$2,now())
     ON CONFLICT (genieacs_id) DO UPDATE SET subscriber_id=EXCLUDED.subscriber_id, updated_at=now()`,
    [id, subscriberId]
  );
  await logAction({ device_id: id, action: 'LINK_SUBSCRIBER', payload: { subscriber_id: subscriberId }, status: 'DONE', created_by: (req as any).user?.id });
  res.json({ ok: true });
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

export default router;
