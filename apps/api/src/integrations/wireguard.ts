import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export type WgHubConfig = any;
export type WgPeer = any;

function b64urlToBuf(s: string) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

export async function generateWgKeypair(): Promise<{ privateKey: string; publicKey: string }> {
  // Prefer wg tools if available
  try {
    const { stdout: privOut } = await execFileAsync('wg', ['genkey'], { timeout: 5000 });
    const privateKey = String(privOut || '').trim();
    const { stdout: pubOut } = await execFileAsync('wg', ['pubkey'], { timeout: 5000, maxBuffer: 1024 * 64 } as any);
    // need to pipe priv to pubkey
  } catch {}
  try {
    const { stdout } = await execAsync('wg genkey | tee /tmp/.wgpriv | wg pubkey; echo "---SEP---"; cat /tmp/.wgpriv', { timeout: 5000 });
    const parts = String(stdout || '').split('---SEP---');
    if (parts.length >= 2) {
      const publicKey = parts[0].trim();
      const privateKey = parts[1].trim();
      if (privateKey && publicKey) {
        try { await fs.unlink('/tmp/.wgpriv'); } catch {}
        return { privateKey, publicKey };
      }
    }
  } catch {}
  // Fallback: Node X25519 (best-effort). Prefer wg tools in production for canonical WireGuard keys.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const privJwk: any = privateKey.export({ format: 'jwk' });
  const pubJwk: any = publicKey.export({ format: 'jwk' });
  const priv = b64urlToBuf(privJwk.d);
  const pub = b64urlToBuf(pubJwk.x);
  // Use the generated keypair as-is (valid X25519). Clamping is handled by WireGuard implementations when applied.
  return { privateKey: priv.toString('base64'), publicKey: pub.toString('base64') };
}

export async function generatePresharedKey(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('wg', ['genpsk'], { timeout: 5000 });
    const k = String(stdout || '').trim();
    if (k) return k;
  } catch {}
  return crypto.randomBytes(32).toString('base64');
}

export function parseCidrBase(cidr: string): { base: string; prefix: number } {
  const [base, p] = String(cidr || '10.77.0.0/16').split('/');
  return { base: base || '10.77.0.0', prefix: Number(p || 24) };
}

export function ipToInt(ip: string): number {
  return ip.split('.').reduce((a, n) => (a << 8) + (Number(n) || 0), 0) >>> 0;
}
export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export async function allocateTunnelIp(pool: any, overlayCidr: string, hubAddress: string): Promise<string> {
  const used = new Set<string>((await pool.query('SELECT tunnel_ip FROM wg_peers')).rows.map((r: any) => String(r.tunnel_ip || '').split('/')[0]));
  const hubIp = String(hubAddress || '10.77.0.1/16').split('/')[0];
  used.add(hubIp);
  const { base } = parseCidrBase(overlayCidr);
  const start = (ipToInt(base) & 0xffff0000) >>> 0; // assume /16-ish planning baseline
  // allocate from .0.2 upward in /16 space for simplicity
  for (let i = 2; i < 65534; i++) {
    const candidate = intToIp((start + i) >>> 0);
    if (candidate.endsWith('.0') || candidate.endsWith('.255')) continue;
    if (!used.has(candidate)) return `${candidate}/32`;
  }
  throw new Error('No available tunnel IPs in overlay');
}

export function buildHubWgConfig(hub: WgHubConfig, peers: WgPeer[]): string {
  const lines: string[] = [];
  lines.push('[Interface]');
  lines.push(`Address = ${hub.hub_address || '10.77.0.1/16'}`);
  if (hub.listen_port) lines.push(`ListenPort = ${hub.listen_port}`);
  if (hub.private_key) lines.push(`PrivateKey = ${hub.private_key}`);
  if (hub.mtu) lines.push(`MTU = ${hub.mtu}`);
  // basic forwarding hooks can be added by container; keep config minimal/portable
  for (const p of peers) {
    if (!p.public_key) continue;
    const allowed = new Set<string>();
    const tip = String(p.tunnel_ip || '').split(',')[0].trim();
    if (tip) allowed.add(tip.includes('/') ? tip : `${tip}/32`);
    for (const a of (p.allowed_ips || [])) if (a) allowed.add(String(a));
    for (const c of (p.olt_mgmt_cidrs || [])) if (c) allowed.add(String(c));
    lines.push('');
    lines.push('[Peer]');
    if (p.name || p.site_name) lines.push(`# ${p.name || ''}${p.site_name ? ' (' + p.site_name + ')' : ''}`);
    lines.push(`PublicKey = ${p.public_key}`);
    if (p.preshared_key) lines.push(`PresharedKey = ${p.preshared_key}`);
    if (allowed.size) lines.push(`AllowedIPs = ${Array.from(allowed).join(', ')}`);
  }
  return lines.join('\n') + '\n';
}

export function buildRouterOsScript(hub: WgHubConfig, peer: WgPeer): string {
  const ifName = `wg-${(peer.name || 'izandesk').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 12) || 'izandesk'}`;
  const hubEndpoint = String(hub.endpoint_host || '<HUB_PUBLIC_IP_OR_DNS>').trim();
  const hubPort = Number(hub.endpoint_port || hub.listen_port || 51820);
  const hubPub = String(hub.public_key || '<HUB_PUBLIC_KEY>').trim();
  const peerAddr = String(peer.tunnel_ip || '10.77.0.2/32').trim();
  const keepalive = Number(peer.keepalive_sec || 25);
  const allowed = new Set<string>();
  // route overlay and hub tunnel network by default
  const overlay = String(hub.overlay_cidr || '10.77.0.0/16');
  allowed.add(overlay);
  for (const a of (peer.allowed_ips || [])) if (a) allowed.add(String(a));
  const allowedStr = Array.from(allowed).join(',');
  const lines: string[] = [];
  lines.push(`# IzanDesk WireGuard bootstrap (RouterOS v7+)`);
  lines.push(`# Peer: ${peer.name || peer.id}  Site: ${peer.site_name || ''}`);
  lines.push(`/interface/wireguard add name=${ifName} listen-port=51820 mtu=${hub.mtu || 1420} comment="IzanDesk-WG";`);
  if (peer.private_key) {
    lines.push(`/interface/wireguard set [find name=${ifName}] private-key="${peer.private_key}";`);
  } else {
    lines.push(`# Set private-key if provided, or let RouterOS keep generated key and register its public key in IzanDesk.`);
  }
  lines.push(`/ip/address add address=${peerAddr} interface=${ifName} comment="IzanDesk-WG";`);
  lines.push(`/interface/wireguard/peers add interface=${ifName} name=izandesk-hub public-key="${hubPub}" endpoint-address=${hubEndpoint} endpoint-port=${hubPort} allowed-address=${allowedStr} persistent-keepalive=${keepalive}s comment="IzanDesk-Hub";`);
  lines.push(`/ip/firewall/filter add chain=input protocol=udp dst-port=51820 action=accept place-before=0 comment="IzanDesk-WG" disabled=yes;`);
  lines.push(`:put "IzanDesk WireGuard bootstrap applied (review firewall/routes as needed).";`);
  return lines.join('\n') + '\n';
}

export async function readHubRuntimeStatus(configDir?: string): Promise<{ ok: boolean; peers: any[]; raw?: string; error?: string; source?: string }> {
  const parseDump = (raw: string) => {
    const peers: any[] = [];
    for (const line of String(raw || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length >= 8) {
        peers.push({
          interface: parts[0],
          public_key: parts[1],
          preshared_key: parts[2] && parts[2] !== '(none)' ? parts[2] : null,
          endpoint: parts[3] && parts[3] !== '(none)' ? parts[3] : null,
          allowed_ips: parts[4],
          latest_handshake: Number(parts[5] || 0),
          rx_bytes: Number(parts[6] || 0),
          tx_bytes: Number(parts[7] || 0),
          keepalive: parts[8] ? Number(parts[8]) : null,
        });
      }
    }
    return peers;
  };
  try {
    const { stdout } = await execFileAsync('wg', ['show', 'all', 'dump'], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
    const raw = String(stdout || '');
    return { ok: true, peers: parseDump(raw), raw, source: 'wg' };
  } catch (e: any) {
    // Bridge: wg-hub container can write status.json in shared config dir
    try {
      const dir = configDir || process.env.WG_CONFIG_DIR || path.resolve(__dirname, '../../../../docker/wg-hub/config');
      const file = path.join(dir, 'status.json');
      const txt = await fs.readFile(file, 'utf8');
      const j = JSON.parse(txt);
      if (j && Array.isArray(j.peers)) return { ok: true, peers: j.peers, raw: j.raw, source: 'bridge', error: e.message || String(e) };
      if (j && typeof j.raw === 'string') return { ok: true, peers: parseDump(j.raw), raw: j.raw, source: 'bridge', error: e.message || String(e) };
    } catch {}
    return { ok: false, peers: [], error: e.message || String(e) };
  }
}

export async function writeHubConfigFile(configDir: string, hub: WgHubConfig, peers: WgPeer[]): Promise<string> {
  await fs.mkdir(configDir, { recursive: true });
  const file = path.join(configDir, `${hub.interface_name || 'wg0'}.conf`);
  await fs.writeFile(file, buildHubWgConfig(hub, peers), { mode: 0o600 });
  try {
    const routes = new Set<string>();
    for (const p of (peers || [])) {
      for (const c of (p.olt_mgmt_cidrs || [])) {
        const v = String(c || '').trim();
        if (v) routes.add(v);
      }
    }
    await fs.writeFile(path.join(configDir, 'olt_routes.txt'), Array.from(routes).sort().join('\n') + (routes.size ? '\n' : ''), { mode: 0o644 });
  } catch {}
  return file;
}
