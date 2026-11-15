import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';

const router: Router = Router();

const ACS_BASE = process.env.GENIEACS_URL || process.env.ACS_URL || '';
const ACS_USER = process.env.GENIEACS_USER || process.env.ACS_USER || '';
const ACS_PASS = process.env.GENIEACS_PASS || process.env.ACS_PASS || '';

async function acsFetch(p: string, init: any = {}) {
  if (!ACS_BASE) throw new Error('GenieACS/TR-069 ACS is not configured (set GENIEACS_URL)');
  const url = ACS_BASE.replace(/\/$/, '') + p;
  const headers: any = { 'Content-Type': 'application/json', ...(init.headers||{}) };
  if (ACS_USER) headers['Authorization'] = 'Basic ' + Buffer.from(`${ACS_USER}:${ACS_PASS}`).toString('base64');
  const r = await fetch(url, { ...init, headers } as any);
  const text = await r.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(typeof data === 'string' ? data : (data?.message || `ACS error ${r.status}`));
  return data;
}

router.get('/status', asyncHandler(async (_req, res) => {
  res.json({ ok: true, configured: !!ACS_BASE, baseUrl: ACS_BASE || null });
}));

router.get('/devices', asyncHandler(async (req, res) => {
  if (!ACS_BASE) return res.json({ ok: true, configured: false, data: [], message: 'GenieACS not configured' });
  let queryObj: any = {};
  if (req.query.query) {
    try { queryObj = JSON.parse(String(req.query.query)); }
    catch { return res.status(400).json({ ok: false, configured: true, message: 'Invalid query JSON' }); }
  }
  try {
    const q = encodeURIComponent(JSON.stringify(queryObj));
    const data = await acsFetch(`/devices/?query=${q}&limit=100`);
    res.json({ ok: true, configured: true, data });
  } catch (e:any) { res.status(502).json({ ok: false, configured: true, message: e.message }); }
}));

router.post('/wifi', asyncHandler(async (req, res) => {
  // Update Wi-Fi SSID/password for a device (by GenieACS device id) via TR-069 parameters
  const b = req.body || {};
  const deviceId = String(b.device_id || b.deviceId || '').trim();
  const ssid = b.ssid;
  const password = b.password;
  if (!deviceId) return res.status(400).json({ message: 'device_id is required' });
  if (!ACS_BASE) return res.status(501).json({ ok: false, configured: false, message: 'GenieACS/TR-069 ACS not configured. Set GENIEACS_URL (and credentials) to enable Wi-Fi SSID/password management.' });
  const params: any[] = [];
  const ssidPath = b.ssid_path || 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID';
  const passPath = b.password_path || b.key_path || 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase';
  if (ssid != null) params.push({ name: ssidPath, value: String(ssid) });
  if (password != null) params.push({ name: passPath, value: String(password) });
  if (!params.length) return res.status(400).json({ message: 'ssid and/or password required' });
  try {
    // GenieACS NBI task
    const task = { name: 'setParameterValues', parameterValues: params.map(p => [p.name, p.value, 'xsd:string']) };
    const data = await acsFetch(`/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, { method: 'POST', body: JSON.stringify(task) });
    // optionally store mapping
    try { await pool.query(`INSERT INTO acs_device_actions(device_id, action, payload, result, created_at) VALUES($1,$2,$3::jsonb,$4::jsonb,now())`, [deviceId, 'WIFI_UPDATE', JSON.stringify({ ssid, password: password ? '***' : undefined }), JSON.stringify(data)]); } catch {}
    res.json({ ok: true, device_id: deviceId, task: data });
  } catch (e:any) { res.status(502).json({ ok: false, message: e.message }); }
}));

export default router;
