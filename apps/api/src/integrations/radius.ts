import dgram from 'dgram';
import dns from 'dns';
import crypto from 'crypto';
import { pool } from '../db';

export async function syncNasForRouter(router: any, oldHost?: string | null) {
  if (!router) return;
  const mode = String(router.integration_mode || '').toUpperCase();
  const host = String(router.host || '').trim();
  const secret = router.radius_secret ? String(router.radius_secret) : '';
  const shortname = String(router.nas_identifier || router.name || '').trim() || null;
  const desc = `IzanDesk router ${router.id || ''}`.trim();

  // remove old NAS entry if host changed
  if (oldHost && oldHost !== host) {
    try { await pool.query('DELETE FROM nas WHERE nasname=$1', [oldHost]); } catch {}
  }

  if (mode === 'RADIUS' && host && secret && router.is_enabled !== false) {
    await pool.query(`INSERT INTO nas(nasname, shortname, type, ports, secret, description)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (nasname) DO UPDATE SET shortname=EXCLUDED.shortname, type=EXCLUDED.type, ports=EXCLUDED.ports, secret=EXCLUDED.secret, description=EXCLUDED.description`,
      [host, shortname, 'other', router.coa_port ? Number(router.coa_port) : 3799, secret, desc]);
  } else if (host) {
    // if not a RADIUS NAS (or disabled/secret removed), remove managed NAS entry for this host
    try { await pool.query('DELETE FROM nas WHERE nasname=$1', [host]); } catch {}
  }
  return { ok: true, nasname: host, mode };
}

export async function removeNasForRouter(router: any) {
  if (!router) return;
  const host = String(router.host || '').trim();
  if (host) { try { await pool.query('DELETE FROM nas WHERE nasname=$1', [host]); } catch {} }
}

export async function syncAllRadiusNas() {
  const r = await pool.query("SELECT * FROM network_routers WHERE integration_mode='RADIUS'");
  for (const row of r.rows) await syncNasForRouter(row);
  return { synced: r.rows.length };
}

/** Address list a router admin must define to enforce parental filtering.
 *  Disabled users are placed in this list via a Mikrotik-Address-List reply. */
export const PARENTAL_CONTROL_ADDRESS_LIST = process.env.PARENTAL_CONTROL_ADDRESS_LIST || 'izn-parental-control';

export async function syncSubscriberToRadiusDb(sub: any, opts: { walledGarden?: boolean; restrictedRateLimit?: string; addressList?: string; fupRateLimit?: string | null; fupExceeded?: boolean; parentalAddressList?: string } = {}) {
  const username = String(sub.username || '').trim();
  if (!username) return { skipped: true, reason: 'no username' };
  const password = String(sub.password || 'changeme');
  const profile = String(sub.profile_name || sub.package_name || 'default');
  const ip = sub.ip_address || null;
  const suspended = sub.status === 'SUSPENDED' || sub.status === 'TERMINATED' || sub.status === 'EXPIRED';
  const walled = !!(opts.walledGarden || sub.walled_garden || sub.suspension_stage === 'WALLED_GARDEN' || sub.suspension_stage === 'ISOLATED');

  await pool.query('DELETE FROM radcheck WHERE username=$1', [username]);
  await pool.query('DELETE FROM radreply WHERE username=$1', [username]);
  await pool.query('DELETE FROM radusergroup WHERE username=$1', [username]);

  if (suspended && !walled) {
    await pool.query("INSERT INTO radcheck(username,attribute,op,value) VALUES($1,'Auth-Type',':=','Reject')", [username]);
  } else {
    await pool.query("INSERT INTO radcheck(username,attribute,op,value) VALUES($1,'Cleartext-Password',':=',$2)", [username, password]);
  }
  if (profile) await pool.query("INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Mikrotik-Group',':=',$2)", [username, profile]);
  if (ip) await pool.query("INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Framed-IP-Address',':=',$2)", [username, String(ip)]);
  const fup = !suspended && !walled && (opts.fupExceeded || !!opts.fupRateLimit) && opts.fupRateLimit ? String(opts.fupRateLimit) : null;
  if (walled && !suspended) {
    const addrList = opts.addressList || 'izn-walled-garden';
    const rl = opts.restrictedRateLimit || '64k/64k';
    await pool.query("INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Mikrotik-Address-List',':=',$2)", [username, addrList]);
    await pool.query("INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Mikrotik-Rate-Limit',':=',$2)", [username, rl]);
    await pool.query("INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Reply-Message',':=',$2)", [username, 'Account restricted: please pay outstanding dues to restore service']);
  } else if (fup) {
    await pool.query("INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Mikrotik-Rate-Limit',':=',$2)", [username, fup]);
    await pool.query("INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Reply-Message',':=',$2)", [username, 'FUP/data cap reached: speed reduced until next billing cycle']);
  }
  // Parental control: a dedicated address list the router uses for filtered
  // access. Billing restrictions (walled garden / suspension) take precedence,
  // so the two never compete for the same Mikrotik-Address-List attribute.
  const parental = !suspended && !walled && !!(opts.parentalAddressList || sub.parental_control_enabled);
  const parentalList = parental ? (opts.parentalAddressList || PARENTAL_CONTROL_ADDRESS_LIST) : null;
  if (parentalList) {
    await pool.query("INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Mikrotik-Address-List',':=',$2)", [username, parentalList]);
  }
  await pool.query("INSERT INTO radusergroup(username,groupname,priority) VALUES($1,$2,1)", [username, profile || 'default']);
  return { ok: true, username, profile, walled_garden: walled && !suspended, suspended: suspended && !walled, fup_applied: !!fup, fup_rate_limit: fup,
    parental_control: parental, parental_address_list: parentalList };
}

/** Remove all RADIUS artifacts for a username (used when a subscriber is deleted or renamed). */
export async function removeSubscriberFromRadiusDb(username: string) {
  const u = String(username || '').trim();
  if (!u) return { ok: true, skipped: true, reason: 'no username' };
  await pool.query('DELETE FROM radcheck WHERE username=$1', [u]);
  await pool.query('DELETE FROM radreply WHERE username=$1', [u]);
  await pool.query('DELETE FROM radusergroup WHERE username=$1', [u]);
  await pool.query('DELETE FROM radius_users WHERE username=$1', [u]).catch(() => {});
  return { ok: true, username: u };
}

function encodeAttr(type: number, value: Buffer) {
  const b = Buffer.alloc(2 + value.length);
  b[0] = type; b[1] = b.length; value.copy(b, 2); return b;
}
function encodeStringAttr(type: number, str: string) { return encodeAttr(type, Buffer.from(str, 'utf8')); }

function encodeMikrotikVsa(vendorType: number, value: string) {
  const vsaVal = Buffer.concat([Buffer.from([vendorType]), Buffer.alloc(1), Buffer.from(String(value), 'utf8')]);
  vsaVal[1] = vsaVal.length;
  const vendor = Buffer.alloc(4); vendor.writeUInt32BE(14988, 0);
  return encodeAttr(26, Buffer.concat([vendor, vsaVal]));
}

export async function sendCoaPacket(opts: { host: string; port: number; secret: string; username: string; action: 'DISCONNECT'|'COA'; attributes?: Record<string,string> }) {
  const code = opts.action === 'DISCONNECT' ? 40 : 43; // Disconnect-Request / CoA-Request
  const id = crypto.randomInt(1, 255);
  const attrs: Buffer[] = [];
  attrs.push(encodeStringAttr(1, opts.username)); // User-Name
  if (opts.attributes) {
    for (const [k, v] of Object.entries(opts.attributes)) {
      if (v == null || v === '') continue;
      const key = String(k);
      if (key === 'Mikrotik-Rate-Limit' || key === 'rate-limit') attrs.push(encodeMikrotikVsa(8, String(v)));
      else if (key === 'Mikrotik-Address-List' || key === 'address-list') attrs.push(encodeMikrotikVsa(19, String(v)));
      else if (key === 'Mikrotik-Group' || key === 'group') attrs.push(encodeMikrotikVsa(3, String(v)));
    }
  }
  const body = Buffer.concat(attrs);
  const len = 20 + body.length;
  const head = Buffer.alloc(4); head[0] = code; head[1] = id; head.writeUInt16BE(len, 2);
  const zeroAuth = Buffer.alloc(16, 0);
  // RFC 3576: Request Authenticator = MD5(Code+ID+Length+16 zero octets+Attributes+Secret)
  const requestAuth = crypto.createHash('md5').update(Buffer.concat([head, zeroAuth, body, Buffer.from(opts.secret, 'utf8')])).digest();
  const packet = Buffer.concat([head, requestAuth, body]);

  // Resolve once so replies can be bound to the NAS address. Accepting any
  // UDP packet with code 41/44 lets a local attacker spoof successful CoA.
  const resolved = await dns.promises.lookup(opts.host, { all: true }).catch(() => [{ address: opts.host }]);
  const addresses = new Set(resolved.map((r: any) => String(r.address)));
  const target = resolved[0]?.address || opts.host;

  const once = () => new Promise<{ok:boolean; code?:number; error?:string}>((resolve) => {
    const sock = dgram.createSocket('udp4');
    let settled = false;
    const finish = (result: {ok:boolean; code?:number; error?:string}) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      try { sock.close(); } catch {}
      resolve(result);
    };
    const to = setTimeout(() => finish({ ok: false, error: 'timeout (no CoA/Disconnect response from NAS)' }), 3000);
    sock.on('message', (msg: Buffer, rinfo) => {
      if (!addresses.has(rinfo.address)) return; // ignore spoofed source
      if (msg.length < 20) return;
      const length = msg.readUInt16BE(2);
      if (length !== msg.length || msg[1] !== id) return;
      const responseAuth = msg.subarray(4, 20);
      const attrs = msg.subarray(20, length);
      const expected = crypto.createHash('md5').update(Buffer.concat([
        msg.subarray(0, 4), requestAuth, attrs, Buffer.from(opts.secret, 'utf8'),
      ])).digest();
      if (responseAuth.length !== expected.length || !crypto.timingSafeEqual(responseAuth, expected)) return;
      const rcode = msg[0]; // 41 Disconnect-ACK, 42 Disconnect-NAK, 44 CoA-ACK, 45 CoA-NAK
      const expectedCode = opts.action === 'DISCONNECT' ? 41 : 44;
      finish({ ok: rcode === expectedCode, code: rcode });
    });
    sock.on('error', (e) => finish({ ok: false, error: e.message }));
    sock.send(packet, opts.port, target, (err) => { if (err) finish({ ok: false, error: err.message }); });
  });

  let last: any = null;
  for (let i = 0; i < 2; i++) {
    last = await once();
    if (last.ok) return last;
  }
  return last;
}

export async function probeRadiusNas(router: any): Promise<{ ok: boolean; reachable: boolean; code?: number; error?: string }> {
  const host = String(router?.host || '').trim();
  const secret = String(router?.radius_secret || '').trim();
  const port = Number(router?.coa_port || 3799);
  if (!host || !secret) return { ok: false, reachable: false, error: 'Missing NAS host or radius_secret' };
  const res = await sendCoaPacket({
    host,
    port,
    secret,
    username: '__izandesk_reachability_probe__',
    action: 'DISCONNECT',
  });
  // Any valid RADIUS response (ACK/NAK) proves the NAS is reachable and
  // authenticated the shared secret. Timeout/network errors mean unreachable.
  const reachable = res.code === 41 || res.code === 42 || res.code === 44 || res.code === 45 || res.ok === true;
  return { ok: reachable, reachable, code: res.code, error: reachable ? undefined : res.error };
}
