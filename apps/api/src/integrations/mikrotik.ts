import { RouterOSAPI } from 'node-routeros';
import * as https from 'https';

export type RouterRow = any;

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

function rosOpts(r: RouterRow, mode: 'API'|'REST') {
  const host = String(r.host || '').trim();
  const user = String(r.username || 'admin');
  const password = String(r.password || '');
  const timeout = 8;
  if (mode === 'REST') {
    const port = Number(r.rest_port || (r.use_ssl ? 443 : 80));
    const scheme = r.use_ssl ? 'https' : 'http';
    return { host, user, password, port, scheme, timeout, insecure: !!r.use_ssl };
  }
  const port = Number(r.api_port || (r.use_ssl ? 8729 : 8728));
  return { host, user, password, port, tls: !!r.use_ssl, timeout };
}

async function restFetch(o: any, path: string) {
  const url = `${o.scheme}://${o.host}:${o.port}/rest${path}`;
  const auth = Buffer.from(`${o.user}:${o.password}`).toString('base64');
  const init: any = { headers: { Authorization: `Basic ${auth}` }, signal: (AbortSignal as any).timeout(o.timeout * 1000) };
  // Node fetch: for self-signed https, use dispatcher if available, else fallback to https module
  if (o.scheme === 'https') {
    try {
      const undici = require('undici');
      if (undici?.Agent) init.dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
    } catch {
      // fallback handled below by using https.get/post via manual fetch? easier: set env not ideal; use node https
      return await restFetchHttps(o, path);
    }
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`REST ${res.status}: ${await res.text().catch(()=>'')}`);
  return res.json();
}

function restFetchHttps(o: any, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${o.user}:${o.password}`).toString('base64');
    const req = https.request({ hostname: o.host, port: o.port, path: `/rest${path}`, method: 'GET', headers: { Authorization: `Basic ${auth}` }, agent: insecureAgent, timeout: o.timeout * 1000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data || 'null')); } catch { resolve(data); }
        } else reject(new Error(`REST ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

export async function mikrotikTest(r: RouterRow) {
  const mode = String(r.integration_mode || 'API').toUpperCase() as 'API'|'REST';
  if (mode === 'REST') {
    const o = rosOpts(r, 'REST') as any;
    const data: any = await restFetch(o, '/system/identity').catch(async (e) => { if (o.scheme === 'https') return restFetchHttps(o, '/system/identity'); throw e; });
    return { ok: true, identity: data?.name || data?.identity || r.name, mode: 'REST' };
  }
  const o = rosOpts(r, 'API') as any;
  const api = new RouterOSAPI({ host: o.host, user: o.user, password: o.password, port: o.port, tls: o.tls, timeout: o.timeout });
  try {
    await api.connect();
    const ident = await api.write('/system/identity/print');
    const name = (ident && ident[0] && (ident[0].name || ident[0]['name'])) || r.name;
    return { ok: true, identity: name, mode: 'API' };
  } finally {
    try { api.close(); } catch {}
  }
}

export async function mikrotikTelemetry(r: RouterRow) {
  const mode = String(r.integration_mode || 'API').toUpperCase();
  if (mode === 'REST') {
    const o = rosOpts(r, 'REST') as any;
    const [resource, ident] = await Promise.all([
      restFetch(o, '/system/resource').catch(async (e) => { if (o.scheme === 'https') return restFetchHttps(o, '/system/resource'); throw e; }),
      restFetch(o, '/system/identity').catch(async () => { try { if (o.scheme === 'https') return await restFetchHttps(o, '/system/identity'); } catch {} return {}; })
    ]);
    const reso: any = resource || {};
    const totalMem = Number(reso['total-memory'] || reso.total_memory || 0);
    const freeMem = Number(reso['free-memory'] || reso.free_memory || 0);
    const uptime = parseUptime(String(reso.uptime || '0s'));
    return {
      status: 'ONLINE',
      cpu_load: Number(reso['cpu-load'] || reso.cpu_load || 0),
      memory_total_mb: totalMem ? +(totalMem / 1024 / 1024).toFixed(2) : null,
      memory_used_mb: totalMem && freeMem ? +((totalMem - freeMem) / 1024 / 1024).toFixed(2) : null,
      uptime_seconds: uptime,
      identity: (ident as any).name || (ident as any).identity || r.identity,
      board_name: reso['board-name'] || reso.board_name || r.board_name,
      rx_bps: 0, tx_bps: 0,
    };
  }
  const o = rosOpts(r, 'API') as any;
  const api = new RouterOSAPI({ host: o.host, user: o.user, password: o.password, port: o.port, tls: o.tls, timeout: o.timeout });
  try {
    await api.connect();
    const [resource, ident] = await Promise.all([api.write('/system/resource/print'), api.write('/system/identity/print').catch(()=>[])]);
    const reso: any = (resource && resource[0]) || {};
    const totalMem = Number(reso['total-memory'] || 0);
    const freeMem = Number(reso['free-memory'] || 0);
    const uptime = parseUptime(String(reso.uptime || '0s'));
    return {
      status: 'ONLINE',
      cpu_load: Number(reso['cpu-load'] || 0),
      memory_total_mb: totalMem ? +(totalMem / 1024 / 1024).toFixed(2) : null,
      memory_used_mb: totalMem && freeMem ? +((totalMem - freeMem) / 1024 / 1024).toFixed(2) : null,
      uptime_seconds: uptime,
      identity: (ident && ident[0] && ident[0].name) || r.identity,
      board_name: reso['board-name'] || r.board_name,
      rx_bps: 0, tx_bps: 0,
    };
  } finally {
    try { api.close(); } catch {}
  }
}

async function restSend(o: any, method: string, path: string, body?: any) {
  const url = `${o.scheme}://${o.host}:${o.port}/rest${path}`;
  const auth = Buffer.from(`${o.user}:${o.password}`).toString('base64');
  const init: any = { method, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, signal: (AbortSignal as any).timeout(o.timeout * 1000) };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (o.scheme === 'https') {
    try { const undici = require('undici'); if (undici?.Agent) init.dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } }); } catch { return await restSendHttps(o, method, path, body); }
  }
  const res = await fetch(url, init);
  const text = await res.text().catch(()=> '');
  if (!res.ok) throw new Error(`REST ${res.status}: ${text}`);
  try { return text ? JSON.parse(text) : {}; } catch { return text; }
}
function restSendHttps(o: any, method: string, path: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${o.user}:${o.password}`).toString('base64');
    const payload = body !== undefined ? JSON.stringify(body) : '';
    const req = https.request({ hostname: o.host, port: o.port, path: `/rest${path}`, method, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, agent: insecureAgent, timeout: o.timeout * 1000 }, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve(data); } }
        else reject(new Error(`REST ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(new Error('timeout')); }); if (payload) req.write(payload); req.end();
  });
}

export async function mikrotikActiveSessions(r: RouterRow) {
  const mode = String(r.integration_mode || 'API').toUpperCase();
  if (mode === 'REST') {
    const o = rosOpts(r, 'REST') as any;
    const arr: any[] = await restFetch(o, '/ppp/active').catch(async (e) => { if (o.scheme === 'https') return restFetchHttps(o, '/ppp/active'); throw e; }) as any;
    const sessions = (arr || []).map(x => ({ name: x.name, address: x.address, uptime: x.uptime, caller_id: x['caller-id'] || x.caller_id, service: x.service, encoding: x.encoding, 'tx-byte': x['tx-byte'], 'rx-byte': x['rx-byte'], rx_bps: 0, tx_bps: 0 }));
    // best-effort rates: try interface monitor-traffic for first few sessions (REST monitor-traffic support varies)
    for (const s of sessions.slice(0, 20)) {
      try {
        const ifname = `<pppoe-${s.name}>`;
        // REST monitor-traffic is not a simple GET; try interface list bytes as fallback not available; skip if unsupported
        const mt: any = await restSend(o, 'POST', '/interface/monitor-traffic', { interface: ifname, once: true, duration: '1s' }).catch(()=>null);
        if (mt) {
          const m = Array.isArray(mt) ? mt[0] : mt;
          s.rx_bps = Number(m?.['rx-bits-per-second'] || m?.rx_bits_per_second || 0);
          s.tx_bps = Number(m?.['tx-bits-per-second'] || m?.tx_bits_per_second || 0);
        }
      } catch {}
    }
    return sessions;
  }
  const o = rosOpts(r, 'API') as any;
  const api = new RouterOSAPI({ host: o.host, user: o.user, password: o.password, port: o.port, tls: o.tls, timeout: o.timeout });
  try {
    await api.connect();
    const arr: any[] = await api.write('/ppp/active/print').catch(()=>[]) as any;
    const sessions = (arr || []).map(x => ({ name: x.name, address: x.address, uptime: x.uptime, caller_id: x['caller-id'], service: x.service, encoding: x.encoding, 'tx-byte': x['tx-byte'], 'rx-byte': x['rx-byte'], rx_bps: 0, tx_bps: 0 }));
    // fetch real rates for active sessions (best-effort, limited to avoid long delays)
    for (const s of sessions.slice(0, 25)) {
      try {
        const ifname = `<pppoe-${s.name}>`;
        const mt: any[] = await api.write('/interface/monitor-traffic', [`=interface=${ifname}`, '=once=']).catch(()=>[]) as any;
        if (mt && mt[0]) {
          s.rx_bps = Number(mt[0]['rx-bits-per-second'] || 0);
          s.tx_bps = Number(mt[0]['tx-bits-per-second'] || 0);
        }
      } catch {}
    }
    return sessions;
  } finally { try { api.close(); } catch {} }
}

function pkgRateLimit(p: any) {
  const up = Number(p.upload_mbps || p.download_mbps || 1);
  const down = Number(p.download_mbps || p.upload_mbps || 1);
  // MikroTik rate-limit format: rx/tx (upload/download from client perspective often written as "upM/downM")
  const base = `${up}M/${down}M`;
  const bu = p.burst_upload_mbps, bd = p.burst_download_mbps, btu = p.burst_threshold_upload_mbps, btd = p.burst_threshold_download_mbps, bt = p.burst_time_sec;
  if (bu && bd && btu && btd && bt) return `${bu}M/${bd}M ${btu}M/${btd}M ${bt}/${bt}`;
  return base;
}

export async function mikrotikSyncPackage(r: RouterRow, p: any) {
  const mode = String(r.integration_mode || 'API').toUpperCase();
  const profileName = String(p.profile_name || p.name || '').trim();
  const rate = pkgRateLimit(p);
  if (!profileName) throw new Error('Package profile/name required');

  if (mode === 'REST') {
    const o = rosOpts(r, 'REST') as any;
    // PPP profile upsert
    const existing: any[] = await restFetch(o, `/ppp/profile?name=${encodeURIComponent(profileName)}`).catch(async (e) => { if (o.scheme === 'https') return restFetchHttps(o, `/ppp/profile?name=${encodeURIComponent(profileName)}`); throw e; }) as any;
    let ref = profileName;
    if (Array.isArray(existing) && existing.length) {
      const id = existing[0]['.id'] || existing[0].id;
      await restSend(o, 'PATCH', `/ppp/profile/${id}`, { 'rate-limit': rate, comment: `IzanDesk:${p.name}` }).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'PATCH',`/ppp/profile/${id}`,{ 'rate-limit': rate, comment: `IzanDesk:${p.name}` }); throw e; });
      ref = `ppp-profile:${profileName}`;
    } else {
      await restSend(o, 'PUT', `/ppp/profile`, { name: profileName, 'rate-limit': rate, comment: `IzanDesk:${p.name}` }).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'PUT',`/ppp/profile`,{ name: profileName, 'rate-limit': rate, comment: `IzanDesk:${p.name}` }); throw e; });
      ref = `ppp-profile:${profileName}`;
    }
    // if SIMPLE queue requested, also try to ensure a simple queue template exists (optional)
    if (String(p.queue_type||'').toUpperCase() === 'SIMPLE') {
      try {
        const qs: any[] = await restFetch(o, `/queue/simple?name=${encodeURIComponent('pkg-'+profileName)}`).catch(()=>[]) as any;
        const maxLimit = `${Number(p.upload_mbps||1)}M/${Number(p.download_mbps||1)}M`;
        if (Array.isArray(qs) && qs.length) {
          const qid = qs[0]['.id'] || qs[0].id;
          await restSend(o,'PATCH',`/queue/simple/${qid}`,{ 'max-limit': maxLimit, comment: `IzanDesk:${p.name}` }).catch(()=>{});
        } else {
          await restSend(o,'PUT',`/queue/simple`,{ name: 'pkg-'+profileName, target: '0.0.0.0/0', 'max-limit': maxLimit, comment: `IzanDesk:${p.name}`, disabled: 'yes' }).catch(()=>{});
        }
        ref += ',simple-queue:pkg-'+profileName;
      } catch {}
    }
    return { ok: true, remote_ref: ref, mode: 'REST' };
  }

  const o = rosOpts(r, 'API') as any;
  const api = new RouterOSAPI({ host: o.host, user: o.user, password: o.password, port: o.port, tls: o.tls, timeout: o.timeout });
  try {
    await api.connect();
    let ref = profileName;
    const allProfiles: any[] = await api.write('/ppp/profile/print').catch(()=>[]) as any;
    const existing = (allProfiles || []).find((x: any) => String(x.name) === profileName);
    if (existing) {
      await api.write('/ppp/profile/set', [`=.id=${existing['.id']}`, `=rate-limit=${rate}`, `=comment=IzanDesk:${p.name}`]);
      ref = `ppp-profile:${profileName}`;
    } else {
      await api.write('/ppp/profile/add', [`=name=${profileName}`, `=rate-limit=${rate}`, `=comment=IzanDesk:${p.name}`]);
      ref = `ppp-profile:${profileName}`;
    }
    if (String(p.queue_type||'').toUpperCase() === 'SIMPLE') {
      try {
        const qn = 'pkg-'+profileName;
        const maxLimit = `${Number(p.upload_mbps||1)}M/${Number(p.download_mbps||1)}M`;
        const allQs: any[] = await api.write('/queue/simple/print').catch(()=>[]) as any;
        const q = (allQs || []).find((x: any) => String(x.name) === qn);
        if (q) await api.write('/queue/simple/set', [`=.id=${q['.id']}`, `=max-limit=${maxLimit}`, `=comment=IzanDesk:${p.name}`]);
        else await api.write('/queue/simple/add', [`=name=${qn}`, '=target=0.0.0.0/0', `=max-limit=${maxLimit}`, `=comment=IzanDesk:${p.name}`, '=disabled=yes']);
        ref += ',simple-queue:'+qn;
      } catch {}
    }
    return { ok: true, remote_ref: ref, mode: 'API' };
  } finally { try { api.close(); } catch {} }
}

export async function mikrotikSyncPppSecret(r: RouterRow, sub: any) {
  const mode = String(r.integration_mode || 'API').toUpperCase();
  const username = String(sub.username || '').trim();
  if (!username) return { ok: false, skipped: true, reason: 'no username' };
  const password = String(sub.password || '');
  const profile = String(sub.profile_name || sub.package_name || 'default') || 'default';
  const service = 'pppoe';
  const comment = `IzanDesk:${sub.client_code || sub.full_name || ''}`;
  const disabled = (sub.status === 'SUSPENDED' || sub.status === 'TERMINATED' || sub.status === 'EXPIRED') ? 'yes' : 'no';

  if (mode === 'REST') {
    const o = rosOpts(r, 'REST') as any;
    const existing: any[] = await restFetch(o, `/ppp/secret?name=${encodeURIComponent(username)}`).catch(async (e) => { if (o.scheme === 'https') return restFetchHttps(o, `/ppp/secret?name=${encodeURIComponent(username)}`); throw e; }) as any;
    const body: any = { name: username, password, profile, service, comment, disabled };
    if (Array.isArray(existing) && existing.length) {
      const id = existing[0]['.id'] || existing[0].id;
      await restSend(o, 'PATCH', `/ppp/secret/${id}`, body).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'PATCH',`/ppp/secret/${id}`,body); throw e; });
      return { ok: true, action: 'updated', mode: 'REST' };
    } else {
      await restSend(o, 'PUT', `/ppp/secret`, body).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'PUT',`/ppp/secret`,body); throw e; });
      return { ok: true, action: 'created', mode: 'REST' };
    }
  }

  const o = rosOpts(r, 'API') as any;
  const api = new RouterOSAPI({ host: o.host, user: o.user, password: o.password, port: o.port, tls: o.tls, timeout: o.timeout });
  try {
    await api.connect();
    const all: any[] = await api.write('/ppp/secret/print').catch(()=>[]) as any;
    const existing = (all || []).find((x:any)=>String(x.name)===username);
    if (existing) {
      await api.write('/ppp/secret/set', [`=.id=${existing['.id']}`, `=password=${password}`, `=profile=${profile}`, `=service=${service}`, `=comment=${comment}`, `=disabled=${disabled}`]);
      return { ok: true, action: 'updated', mode: 'API' };
    } else {
      await api.write('/ppp/secret/add', [`=name=${username}`, `=password=${password}`, `=profile=${profile}`, `=service=${service}`, `=comment=${comment}`, `=disabled=${disabled}`]);
      return { ok: true, action: 'created', mode: 'API' };
    }
  } finally { try { api.close(); } catch {} }
}

export async function mikrotikRemovePppSecret(r: RouterRow, username: string) {
  const mode = String(r.integration_mode || 'API').toUpperCase();
  const uname = String(username || '').trim();
  if (!uname) return { ok: false, skipped: true };
  if (mode === 'REST') {
    const o = rosOpts(r, 'REST') as any;
    const existing: any[] = await restFetch(o, `/ppp/secret?name=${encodeURIComponent(uname)}`).catch(async (e) => { if (o.scheme === 'https') return restFetchHttps(o, `/ppp/secret?name=${encodeURIComponent(uname)}`); throw e; }) as any;
    if (Array.isArray(existing) && existing.length) {
      const id = existing[0]['.id'] || existing[0].id;
      await restSend(o, 'DELETE', `/ppp/secret/${id}`).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'DELETE',`/ppp/secret/${id}`); throw e; });
      return { ok: true, action: 'removed', mode: 'REST' };
    }
    return { ok: true, action: 'not_found', mode: 'REST' };
  }
  const o = rosOpts(r, 'API') as any;
  const api = new RouterOSAPI({ host: o.host, user: o.user, password: o.password, port: o.port, tls: o.tls, timeout: o.timeout });
  try {
    await api.connect();
    const all: any[] = await api.write('/ppp/secret/print').catch(()=>[]) as any;
    const existing = (all || []).find((x:any)=>String(x.name)===uname);
    if (existing) { await api.write('/ppp/secret/remove', [`=.id=${existing['.id']}`]); return { ok: true, action: 'removed', mode: 'API' }; }
    return { ok: true, action: 'not_found', mode: 'API' };
  } finally { try { api.close(); } catch {} }
}

export async function mikrotikProvisionWireGuard(r: RouterRow, cfg: { ifName: string; listenPort?: number; privateKey?: string; address: string; peerName?: string; hubPublicKey: string; endpointHost: string; endpointPort: number; allowedAddress: string; keepalive?: number; presharedKey?: string; }) {
  const mode = String(r.integration_mode || 'API').toUpperCase();
  const ifName = String(cfg.ifName || 'wg-izandesk').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 15) || 'wg-izandesk';
  const listenPort = Number(cfg.listenPort || 51820);
  const keepalive = Number(cfg.keepalive || 25);
  const address = String(cfg.address || '').trim();
  if (!address) throw new Error('WireGuard tunnel address is required');
  if (!cfg.hubPublicKey || !cfg.endpointHost) throw new Error('Hub public key and endpoint are required');

  if (mode === 'REST') {
    const o = rosOpts(r, 'REST') as any;
    // find or create interface
    const ifaces: any[] = await restFetch(o, `/interface/wireguard?name=${encodeURIComponent(ifName)}`).catch(async (e)=>{ if (o.scheme==='https') return restFetchHttps(o, `/interface/wireguard?name=${encodeURIComponent(ifName)}`); throw e; }) as any;
    let ifId: string | null = null;
    if (Array.isArray(ifaces) && ifaces.length) { ifId = ifaces[0]['.id'] || ifaces[0].id; }
    const ifBody: any = { name: ifName, 'listen-port': String(listenPort), mtu: '1420', comment: 'IzanDesk-WG' };
    if (cfg.privateKey) ifBody['private-key'] = cfg.privateKey;
    if (ifId) await restSend(o, 'PATCH', `/interface/wireguard/${ifId}`, ifBody).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'PATCH',`/interface/wireguard/${ifId}`,ifBody); throw e; });
    else { const created: any = await restSend(o, 'PUT', `/interface/wireguard`, ifBody).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'PUT',`/interface/wireguard`,ifBody); throw e; }); ifId = created?.['.id'] || created?.ret || null; }

    // address
    const addrs: any[] = await restFetch(o, `/ip/address?interface=${encodeURIComponent(ifName)}`).catch(async (e)=>{ if (o.scheme==='https') return restFetchHttps(o, `/ip/address?interface=${encodeURIComponent(ifName)}`); throw e; }) as any;
    if (Array.isArray(addrs) && addrs.length) {
      const a = addrs.find((x:any)=>String(x.address).startsWith(address.split('/')[0])) || addrs[0];
      await restSend(o,'PATCH',`/ip/address/${a['.id']||a.id}`,{ address, interface: ifName, comment: 'IzanDesk-WG' }).catch(()=>{});
    } else {
      await restSend(o,'PUT',`/ip/address`,{ address, interface: ifName, comment: 'IzanDesk-WG' }).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'PUT',`/ip/address`,{ address, interface: ifName, comment: 'IzanDesk-WG' }); throw e; });
    }

    // peer
    const peers: any[] = await restFetch(o, `/interface/wireguard/peers?interface=${encodeURIComponent(ifName)}`).catch(async (e)=>{ if (o.scheme==='https') return restFetchHttps(o, `/interface/wireguard/peers?interface=${encodeURIComponent(ifName)}`); throw e; }) as any;
    const peerBody: any = { interface: ifName, 'public-key': cfg.hubPublicKey, 'endpoint-address': cfg.endpointHost, 'endpoint-port': String(cfg.endpointPort), 'allowed-address': cfg.allowedAddress, 'persistent-keepalive': `${keepalive}s`, comment: 'IzanDesk-Hub' };
    if (cfg.presharedKey) peerBody['preshared-key'] = cfg.presharedKey;
    const existingPeer = Array.isArray(peers) ? (peers.find((p:any)=>String(p['public-key']||p.public_key)===String(cfg.hubPublicKey)) || peers[0]) : null;
    if (existingPeer) await restSend(o,'PATCH',`/interface/wireguard/peers/${existingPeer['.id']||existingPeer.id}`, peerBody).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'PATCH',`/interface/wireguard/peers/${existingPeer['.id']||existingPeer.id}`, peerBody); throw e; });
    else await restSend(o,'PUT',`/interface/wireguard/peers`, peerBody).catch(async (e)=>{ if (o.scheme==='https') return restSendHttps(o,'PUT',`/interface/wireguard/peers`, peerBody); throw e; });

    // get router public key for hub
    const ifaces2: any[] = await restFetch(o, `/interface/wireguard?name=${encodeURIComponent(ifName)}`).catch(()=>[]) as any;
    const pub = Array.isArray(ifaces2) && ifaces2[0] ? (ifaces2[0]['public-key'] || ifaces2[0].public_key || null) : null;
    return { ok: true, mode: 'REST', interface: ifName, router_public_key: pub };
  }

  const o = rosOpts(r, 'API') as any;
  const api = new RouterOSAPI({ host: o.host, user: o.user, password: o.password, port: o.port, tls: o.tls, timeout: o.timeout });
  try {
    await api.connect();
    const safe = async (cmd: string, params: string[] = []) => { try { return await api.write(cmd, params); } catch (e:any) { if (String(e?.message||'').includes('!empty') || e?.errno==='UNKNOWNREPLY') return []; throw e; } };
    const ifaces: any[] = await safe('/interface/wireguard/print') as any;
    let iface = (ifaces||[]).find((x:any)=>String(x.name)===ifName);
    if (iface) {
      const set = [`=.id=${iface['.id']}`, `=listen-port=${listenPort}`, '=mtu=1420', '=comment=IzanDesk-WG'];
      if (cfg.privateKey) set.push(`=private-key=${cfg.privateKey}`);
      await api.write('/interface/wireguard/set', set);
    } else {
      const add = [`=name=${ifName}`, `=listen-port=${listenPort}`, '=mtu=1420', '=comment=IzanDesk-WG'];
      if (cfg.privateKey) add.push(`=private-key=${cfg.privateKey}`);
      await api.write('/interface/wireguard/add', add);
      const ifaces2: any[] = await safe('/interface/wireguard/print') as any;
      iface = (ifaces2||[]).find((x:any)=>String(x.name)===ifName);
    }
    // address
    const addrs: any[] = await safe('/ip/address/print') as any;
    const addr = (addrs||[]).find((x:any)=>String(x.interface)===ifName);
    if (addr) await api.write('/ip/address/set', [`=.id=${addr['.id']}`, `=address=${address}`, `=interface=${ifName}`, '=comment=IzanDesk-WG']);
    else await api.write('/ip/address/add', [`=address=${address}`, `=interface=${ifName}`, '=comment=IzanDesk-WG']);
    // peer
    const peers: any[] = await safe('/interface/wireguard/peers/print') as any;
    const peer = (peers||[]).find((x:any)=>String(x.interface)===ifName && String(x['public-key'])===String(cfg.hubPublicKey)) || (peers||[]).find((x:any)=>String(x.interface)===ifName);
    const pset = [`=interface=${ifName}`, `=public-key=${cfg.hubPublicKey}`, `=endpoint-address=${cfg.endpointHost}`, `=endpoint-port=${cfg.endpointPort}`, `=allowed-address=${cfg.allowedAddress}`, `=persistent-keepalive=${keepalive}s`, '=comment=IzanDesk-Hub'];
    if (cfg.presharedKey) pset.push(`=preshared-key=${cfg.presharedKey}`);
    if (peer) await api.write('/interface/wireguard/peers/set', [`=.id=${peer['.id']}`, ...pset.slice(1)]);
    else await api.write('/interface/wireguard/peers/add', pset);
    const ifaces3: any[] = await safe('/interface/wireguard/print') as any;
    const iface3 = (ifaces3||[]).find((x:any)=>String(x.name)===ifName);
    return { ok: true, mode: 'API', interface: ifName, router_public_key: iface3 ? (iface3['public-key'] || null) : null };
  } finally { try { api.close(); } catch {} }
}

function parseUptime(s: string): number {
  let sec = 0;
  const re = /(\d+)(w|d|h|m|s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = Number(m[1]);
    if (m[2] === 'w') sec += v * 604800;
    else if (m[2] === 'd') sec += v * 86400;
    else if (m[2] === 'h') sec += v * 3600;
    else if (m[2] === 'm') sec += v * 60;
    else if (m[2] === 's') sec += v;
  }
  return sec || 0;
}
