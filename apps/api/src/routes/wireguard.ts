import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, networkGuard, hasNetworkWrite } from './helpers';
import { allocateTunnelIp, buildHubWgConfig, buildRouterOsScript, generatePresharedKey, generateWgKeypair, readHubRuntimeStatus, writeHubConfigFile } from '../integrations/wireguard';
import { mikrotikProvisionWireGuard } from '../integrations/mikrotik';
import { WG_CONFIG_DIR } from '../config/runtime';

const router: Router = Router();
router.use(networkGuard);

// WireGuard private/preshared keys are live tunnel credentials. The list/detail
// endpoints are reachable by every network *read* role (BILLING_OPERATOR,
// TECHNICIAN), so strip secrets before responding — the same boundary already
// applied to MikroTik secrets in import-preview and RADIUS passwords.
function sanitizeHub<T = any>(hub: T): T {
  if (!hub || typeof hub !== 'object') return hub;
  const { private_key, ...safe } = hub as any;
  return { ...safe, has_private_key: !!private_key } as T;
}
function sanitizePeer<T = any>(peer: T): T {
  if (!peer || typeof peer !== 'object') return peer;
  const { private_key, preshared_key, ...safe } = peer as any;
  return { ...safe, has_private_key: !!private_key, has_preshared_key: !!preshared_key } as T;
}
/** `wg show all dump` raw output contains preshared keys — never return it. */
function sanitizeRuntime<T = any>(runtime: T): T {
  if (!runtime || typeof runtime !== 'object') return runtime;
  const { raw, peers, ...safe } = runtime as any;
  return {
    ...safe,
    peers: (peers || []).map((p: any) => {
      const { preshared_key, ...rest } = p;
      return { ...rest, has_preshared_key: !!preshared_key };
    }),
  } as T;
}

async function getHub() {
  const r = await pool.query('SELECT * FROM wg_hub_config WHERE id=1');
  return r.rows[0];
}

router.get('/hub', asyncHandler(async (_req, res) => {
  const hub = await getHub();
  const runtime = await readHubRuntimeStatus(WG_CONFIG_DIR);
  res.json({ hub: sanitizeHub(hub), runtime: sanitizeRuntime(runtime) });
}));

router.put('/hub', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const cur = await getHub();
  let private_key = cur.private_key;
  let public_key = cur.public_key;
  if (b.regenerate_keys) {
    const kp = await generateWgKeypair();
    private_key = kp.privateKey;
    public_key = kp.publicKey;
  }
  const r = await pool.query(`UPDATE wg_hub_config SET
    enabled=$1, interface_name=$2, listen_port=$3, endpoint_host=$4, endpoint_port=$5,
    hub_address=$6, overlay_cidr=$7, private_key=$8, public_key=$9, dns_servers=$10, mtu=$11, updated_at=now()
    WHERE id=1 RETURNING *`,
    [
      b.enabled ?? cur.enabled,
      b.interface_name ?? cur.interface_name ?? 'wg0',
      Number(b.listen_port ?? cur.listen_port ?? 51820),
      b.endpoint_host ?? cur.endpoint_host ?? null,
      Number(b.endpoint_port ?? cur.endpoint_port ?? b.listen_port ?? cur.endpoint_port ?? 51820),
      b.hub_address ?? cur.hub_address ?? '10.77.0.1/16',
      b.overlay_cidr ?? cur.overlay_cidr ?? '10.77.0.0/16',
      private_key,
      public_key,
      b.dns_servers ?? cur.dns_servers ?? null,
      b.mtu ?? cur.mtu ?? null,
    ]
  );
  const hub = r.rows[0];
  try {
    const peers = (await pool.query('SELECT * FROM wg_peers')).rows;
    await writeHubConfigFile(WG_CONFIG_DIR, hub, peers);
  } catch (e) { /* best-effort */ }
  res.json({ hub: sanitizeHub(hub) });
}));

router.post('/hub/init', asyncHandler(async (req, res) => {
  const cur = await getHub();
  let hub = cur;
  if (!cur.public_key || !cur.private_key || req.body?.regenerate) {
    const kp = await generateWgKeypair();
    const r = await pool.query(`UPDATE wg_hub_config SET private_key=$1, public_key=$2, updated_at=now() WHERE id=1 RETURNING *`, [kp.privateKey, kp.publicKey]);
    hub = r.rows[0];
  }
  try {
    const peers = (await pool.query('SELECT * FROM wg_peers')).rows;
    // Never generate an interface-only wg0.conf from an empty DB: a fresh or
    // restored database must not erase live peers from a shared hub config.
    if (!peers.length) {
      return res.json({ ok: true, hub: sanitizeHub(hub), config_file: null, note: 'Hub keys ready; config write skipped because no peers exist. Ensure wg-hub container/service applies this config and UDP port is reachable.' });
    }
    const file = await writeHubConfigFile(WG_CONFIG_DIR, hub, peers);
    return res.json({ ok: true, hub: sanitizeHub(hub), config_file: file, note: 'Hub keys/config ready. Ensure wg-hub container/service applies this config and UDP port is reachable.' });
  } catch (e: any) {
    return res.json({ ok: true, hub: sanitizeHub(hub), warning: `Config file write failed: ${e.message}` });
  }
}));

router.get('/peers', asyncHandler(async (_req, res) => {
  const peers = (await pool.query(`SELECT p.*, nr.name as router_name, nr.host as router_host, nr.integration_mode as router_integration_mode
    FROM wg_peers p LEFT JOIN network_routers nr ON nr.id=p.router_id ORDER BY p.created_at DESC`)).rows;
  const runtime = await readHubRuntimeStatus(WG_CONFIG_DIR);
  const rtMap = new Map(runtime.peers.map((p: any) => [p.public_key, p]));
  const enriched = peers.map((p: any) => {
    const rt = p.public_key ? rtMap.get(p.public_key) : null;
    return {
      ...p,
      runtime: rt ? { endpoint: rt.endpoint, latest_handshake: rt.latest_handshake, rx_bytes: rt.rx_bytes, tx_bytes: rt.tx_bytes } : null,
      online: rt ? (Date.now()/1000 - Number(rt.latest_handshake || 0) < 180) : false,
    };
  });
  res.json({ data: enriched.map(sanitizePeer), runtime_ok: runtime.ok, runtime_error: runtime.error || null, runtime_source: runtime.source || null });
}));

router.post('/peers', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ message: 'name is required' });
  const hub = await getHub();
  if (!hub.public_key || !hub.private_key) {
    const kp = await generateWgKeypair();
    await pool.query('UPDATE wg_hub_config SET private_key=$1, public_key=$2, updated_at=now() WHERE id=1', [kp.privateKey, kp.publicKey]);
    hub.private_key = kp.privateKey; hub.public_key = kp.publicKey;
  }
  let tunnel_ip = b.tunnel_ip;
  if (!tunnel_ip) tunnel_ip = await allocateTunnelIp(pool, hub.overlay_cidr || '10.77.0.0/16', hub.hub_address || '10.77.0.1/16');
  const kp = b.router_public_key && b.router_private_key ? { publicKey: b.router_public_key, privateKey: b.router_private_key } : await generateWgKeypair();
  const psk = b.preshared_key || (b.use_preshared_key ? await generatePresharedKey() : null);
  const allowed_ips = Array.isArray(b.allowed_ips) ? b.allowed_ips : (b.allowed_ips ? String(b.allowed_ips).split(',').map((s:string)=>s.trim()).filter(Boolean) : []);
  const olt_mgmt_cidrs = Array.isArray(b.olt_mgmt_cidrs) ? b.olt_mgmt_cidrs : (b.olt_mgmt_cidrs ? String(b.olt_mgmt_cidrs).split(',').map((s:string)=>s.trim()).filter(Boolean) : []);
  const r = await pool.query(`INSERT INTO wg_peers(router_id,name,site_name,tunnel_ip,allowed_ips,public_key,private_key,preshared_key,keepalive_sec,status,provision_mode,notes,olt_mgmt_cidrs)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10,$11,$12) RETURNING *`,
    [b.router_id || null, b.name, b.site_name || null, tunnel_ip, allowed_ips, kp.publicKey, kp.privateKey, psk, Number(b.keepalive_sec || 25), b.provision_mode || 'AUTO', b.notes || null, olt_mgmt_cidrs]);
  const peer = r.rows[0];
  try {
    const peers = (await pool.query('SELECT * FROM wg_peers')).rows;
    await writeHubConfigFile(WG_CONFIG_DIR, hub, peers);
  } catch {}
  res.status(201).json({ peer: sanitizePeer(peer), bootstrap_script: buildRouterOsScript(hub, peer) });
}));

router.get('/peers/:id', asyncHandler(async (req, res) => {
  const r = await pool.query(`SELECT p.*, nr.name as router_name, nr.host as router_host, nr.integration_mode as router_integration_mode, nr.username as router_username
    FROM wg_peers p LEFT JOIN network_routers nr ON nr.id=p.router_id WHERE p.id=$1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Peer not found' });
  // The bootstrap script embeds the peer's private key — only key managers
  // (network write roles) should receive it on a read request.
  const bootstrap_script = hasNetworkWrite(req) ? buildRouterOsScript(await getHub(), r.rows[0]) : null;
  res.json({ peer: sanitizePeer(r.rows[0]), bootstrap_script });
}));

router.put('/peers/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const cur = (await pool.query('SELECT * FROM wg_peers WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ message: 'Peer not found' });
  const allowed_ips = Array.isArray(b.allowed_ips) ? b.allowed_ips : (b.allowed_ips ? String(b.allowed_ips).split(',').map((s:string)=>s.trim()).filter(Boolean) : cur.allowed_ips);
  const olt_mgmt_cidrs = Array.isArray(b.olt_mgmt_cidrs) ? b.olt_mgmt_cidrs : (b.olt_mgmt_cidrs ? String(b.olt_mgmt_cidrs).split(',').map((s:string)=>s.trim()).filter(Boolean) : cur.olt_mgmt_cidrs);
  const r = await pool.query(`UPDATE wg_peers SET router_id=$1,name=$2,site_name=$3,tunnel_ip=$4,allowed_ips=$5,keepalive_sec=$6,provision_mode=$7,notes=$8,olt_mgmt_cidrs=$9,updated_at=now() WHERE id=$10 RETURNING *`,
    [b.router_id ?? cur.router_id, b.name ?? cur.name, b.site_name ?? cur.site_name, b.tunnel_ip ?? cur.tunnel_ip, allowed_ips, Number(b.keepalive_sec ?? cur.keepalive_sec ?? 25), b.provision_mode ?? cur.provision_mode, b.notes ?? cur.notes, olt_mgmt_cidrs, req.params.id]);
  const hub = await getHub();
  try { const peers = (await pool.query('SELECT * FROM wg_peers')).rows; await writeHubConfigFile(WG_CONFIG_DIR, hub, peers); } catch {}
  res.json({ peer: sanitizePeer(r.rows[0]), bootstrap_script: buildRouterOsScript(hub, r.rows[0]) });
}));

router.delete('/peers/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM wg_peers WHERE id=$1', [req.params.id]);
  const hub = await getHub();
  try { const peers = (await pool.query('SELECT * FROM wg_peers')).rows; await writeHubConfigFile(WG_CONFIG_DIR, hub, peers); } catch {}
  res.json({ ok: true });
}));

router.get('/peers/:id/bootstrap', asyncHandler(async (req, res) => {
  // The bootstrap script contains the peer private key — key managers only.
  if (!hasNetworkWrite(req)) return res.status(403).json({ message: 'Insufficient permissions to view router bootstrap credentials' });
  const r = await pool.query('SELECT * FROM wg_peers WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Peer not found' });
  const hub = await getHub();
  const script = buildRouterOsScript(hub, r.rows[0]);
  res.json({ script, hub: { endpoint_host: hub.endpoint_host, endpoint_port: hub.endpoint_port, public_key: hub.public_key, overlay_cidr: hub.overlay_cidr }, peer: sanitizePeer(r.rows[0]) });
}));

router.post('/peers/:id/provision', asyncHandler(async (req, res) => {
  const r = await pool.query(`SELECT p.*, nr.* , nr.name as router_name, nr.id as nr_id
    FROM wg_peers p JOIN network_routers nr ON nr.id=p.router_id WHERE p.id=$1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Peer or linked router not found' });
  const row = r.rows[0];
  const hub = await getHub();
  if (!hub.endpoint_host || !hub.public_key) return res.status(400).json({ message: 'Hub endpoint_host and hub keys must be configured first (/wireguard/hub or /wireguard/hub/init)' });
  const routerRow = { id: row.nr_id || row.router_id, name: row.router_name, host: row.host, api_port: row.api_port, rest_port: row.rest_port, username: row.username, password: row.password, integration_mode: row.integration_mode, use_ssl: row.use_ssl };
  const allowed = new Set<string>([String(hub.overlay_cidr || '10.77.0.0/16'), ...(row.allowed_ips || []), ...(row.olt_mgmt_cidrs || [])]);
  const ifName = `wg-${String(row.name || 'izandesk').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 12) || 'izandesk'}`;
  try {
    const result = await mikrotikProvisionWireGuard(routerRow, {
      ifName,
      listenPort: 51820,
      privateKey: row.private_key || undefined,
      address: row.tunnel_ip,
      hubPublicKey: hub.public_key,
      endpointHost: hub.endpoint_host,
      endpointPort: Number(hub.endpoint_port || hub.listen_port || 51820),
      allowedAddress: Array.from(allowed).filter(Boolean).join(','),
      keepalive: Number(row.keepalive_sec || 25),
      presharedKey: row.preshared_key || undefined,
    });
    const routerPub = result.router_public_key || row.public_key || null;
    await pool.query(`UPDATE wg_peers SET status='PROVISIONED', last_error=NULL, public_key=COALESCE($2, public_key), updated_at=now() WHERE id=$1`, [req.params.id, routerPub]);
    const hub2 = await getHub();
    try { const peers = (await pool.query('SELECT * FROM wg_peers')).rows; await writeHubConfigFile(WG_CONFIG_DIR, hub2, peers); } catch {}
    res.json({ ok: true, result, router_public_key: routerPub, bootstrap_script: buildRouterOsScript(hub2, { ...row, public_key: routerPub }) });
  } catch (e: any) {
    await pool.query(`UPDATE wg_peers SET status='ERROR', last_error=$2, updated_at=now() WHERE id=$1`, [req.params.id, e.message || String(e)]);
    res.status(502).json({ ok: false, message: `Provision failed: ${e.message || e}` });
  }
}));

export default router;
