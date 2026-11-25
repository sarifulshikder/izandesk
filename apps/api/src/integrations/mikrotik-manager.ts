import { RouterOSAPI } from 'node-routeros';
import type { RouterRow } from './mikrotik';
import { normalizeMikrotikError } from './mikrotik-errors';
import { decryptSecretValue } from '../security/secret-store';

type Managed = {
  key: string;
  api: RouterOSAPI;
  busy: boolean;
  queue: Array<{ resolve: (api: RouterOSAPI) => void; reject: (e: any) => void }>;
  lastUsed: number;
  configSig: string;
};

const pool = new Map<string, Managed>();
const connecting = new Map<string, Promise<Managed>>();
const IDLE_CLOSE_MS = Math.max(30_000, Number(process.env.MIKROTIK_API_IDLE_MS || 120_000));

function sig(r: RouterRow, mode: 'API' | 'REST'): string {
  const host = String(r.host || '').trim();
  const user = String(r.username || 'admin');
  const password = decryptSecretValue(r.password);
  const tls = !!r.use_ssl;
  const tlsVerify = !!r.tls_verify;
  const port = mode === 'REST' ? Number(r.rest_port || (tls ? 443 : 80)) : Number(r.api_port || (tls ? 8729 : 8728));
  return [r.id || host, host, port, user, password, tls ? '1' : '0', tlsVerify ? '1' : '0', mode].join('|');
}

function keyOf(r: RouterRow, mode: 'API' | 'REST') {
  return `${String(r.id || r.host || 'unknown')}:${mode}`;
}

function makeApi(r: RouterRow, mode: 'API' | 'REST') {
  const host = String(r.host || '').trim();
  const user = String(r.username || 'admin');
  const password = decryptSecretValue(r.password);
  const tls = !!r.use_ssl;
  const ca = String(r.tls_ca_cert || process.env.MIKROTIK_TLS_CA_CERT || '').trim();
  const tlsOpt: any = tls
    ? (r.tls_verify ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : { rejectUnauthorized: false })
    : false;
  const port = mode === 'REST' ? Number(r.rest_port || (tls ? 443 : 80)) : Number(r.api_port || (tls ? 8729 : 8728));
  // keepalive sends a harmless '#' command every timeout/2. Without it the
  // pooled connection goes idle, node-routeros' socket timeout fires after
  // `timeout` seconds and RouterOS logs a logout on every reconnect cycle.
  return new RouterOSAPI({ host, user, password, port, tls: tlsOpt, timeout: 8, keepalive: true });
}

async function connectFresh(r: RouterRow, mode: 'API' | 'REST'): Promise<Managed> {
  const k = keyOf(r, mode);
  const existing = pool.get(k);
  if (existing && (existing.api as any).connected) return existing;
  const api = makeApi(r, mode);
  try {
    await api.connect();
  } catch (e) {
    // node-routeros loses the socket error code on raw connect failures. Keep
    // the original as `cause` but expose a readable message to every caller.
    throw normalizeMikrotikError(e, r);
  }
  // Another caller may have connected while we were awaiting
  const existing2 = pool.get(k);
  if (existing2 && (existing2.api as any).connected) {
    try { await api.close(); } catch {}
    return existing2;
  }
  const m: Managed = { key: k, api, busy: false, queue: [], lastUsed: Date.now(), configSig: sig(r, mode) };
  pool.set(k, m);
  // If the underlying socket drops, remove from pool so next acquire reconnects.
  try {
    (api as any).on?.('close', () => dropManaged(m.key, api));
    (api as any).on?.('error', () => { /* handled by callers; close/drop on release */ });
  } catch {}
  return m;
}

function dropManaged(key: string, api?: RouterOSAPI) {
  const cur = pool.get(key);
  if (cur && (!api || cur.api === api)) {
    pool.delete(key);
  }
}

export async function acquireMikrotikApi(r: RouterRow, mode: 'API' | 'REST' = 'API'): Promise<RouterOSAPI> {
  const k = keyOf(r, mode);
  let m = pool.get(k);
  const wantSig = sig(r, mode);
  if (m && m.configSig !== wantSig) {
    pool.delete(k);
    try { await m.api.close(); } catch {}
    m = undefined;
  }
  if (!m) {
    let p = connecting.get(k);
    if (!p) {
      p = connectFresh(r, mode).finally(() => connecting.delete(k));
      connecting.set(k, p);
    }
    try {
      m = await p;
      if (!pool.has(k)) pool.set(k, m);
    } catch (e) {
      pool.delete(k);
      throw e;
    }
  }
  if (!m.busy && (m.api as any).connected) {
    m.busy = true;
    m.lastUsed = Date.now();
    return m.api;
  }
  if (!m.busy && !(m.api as any).connected) {
    // stale disconnected connection - reconnect (singleflight)
    pool.delete(k);
    try { await m.api.close(); } catch {}
    let p = connecting.get(k);
    if (!p) {
      p = connectFresh(r, mode).finally(() => connecting.delete(k));
      connecting.set(k, p);
    }
    const fresh = await p;
    fresh.busy = true;
    fresh.lastUsed = Date.now();
    if (!pool.has(k)) pool.set(k, fresh);
    return fresh.api;
  }
  // busy - wait in queue
  return await new Promise<RouterOSAPI>((resolve, reject) => {
    m!.queue.push({ resolve, reject });
    // safety timeout so callers don't hang forever
    setTimeout(() => {
      const idx = m!.queue.findIndex((q) => q.resolve === resolve);
      if (idx >= 0) {
        m!.queue.splice(idx, 1);
        reject(new Error('MikroTik API acquire timeout'));
      }
    }, 15_000).unref?.();
  });
}

export async function releaseMikrotikApi(r: RouterRow, api: RouterOSAPI, ok: boolean, mode: 'API' | 'REST' = 'API') {
  const k = keyOf(r, mode);
  const m = pool.get(k);
  if (!m || m.api !== api) {
    if (!ok) try { await api.close(); } catch {}
    return;
  }
  m.lastUsed = Date.now();
  if (!ok || !(api as any).connected) {
    pool.delete(k);
    try { await api.close(); } catch {}
    // fail queued waiters - they'll reconnect on next acquire
    while (m.queue.length) m.queue.shift()!.reject(new Error('MikroTik API connection lost'));
    return;
  }
  const next = m.queue.shift();
  if (next) {
    m.busy = true;
    next.resolve(api);
  } else {
    m.busy = false;
  }
}

export async function invalidateMikrotikApi(routerId: string) {
  for (const mode of ['API', 'REST'] as const) {
    const k = `${routerId}:${mode}`;
    const m = pool.get(k);
    if (m) {
      pool.delete(k);
      while (m.queue.length) m.queue.shift()!.reject(new Error('MikroTik API invalidated'));
      try { await m.api.close(); } catch {}
    }
  }
}

// Periodic idle cleanup - don't keep stale router sessions forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, m] of pool.entries()) {
    if (!m.busy && now - m.lastUsed > IDLE_CLOSE_MS) {
      pool.delete(k);
      try { m.api.close(); } catch {}
    }
  }
}, 60_000).unref?.();
