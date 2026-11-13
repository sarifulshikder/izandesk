import dgram from 'dgram';
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

export async function syncSubscriberToRadiusDb(sub: any, opts: { walledGarden?: boolean; restrictedRateLimit?: string; addressList?: string; fupRateLimit?: string | null; fupExceeded?: boolean } = {}) {
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
  await pool.query("INSERT INTO radusergroup(username,groupname,priority) VALUES($1,$2,1)", [username, profile || 'default']);
  return { ok: true, username, profile, walled_garden: walled && !suspended, suspended: suspended && !walled, fup_applied: !!fup, fup_rate_limit: fup };
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
  const hash = crypto.createHash('md5').update(Buffer.concat([head, zeroAuth, body, Buffer.from(opts.secret, 'utf8')])).digest();
  const packet = Buffer.concat([head, hash, body]);

  const once = () => new Promise<{ok:boolean; code?:number; error?:string}>((resolve) => {
    const sock = dgram.createSocket('udp4');
    const to = setTimeout(() => { try{sock.close();}catch{} resolve({ ok: false, error: 'timeout (no CoA/Disconnect response from NAS)' }); }, 3000);
    sock.on('message', (msg) => {
      clearTimeout(to);
      const rcode = msg[0]; // 41 Disconnect-ACK, 42 Disconnect-NAK, 44 CoA-ACK, 45 CoA-NAK
      try{sock.close();}catch{}
      resolve({ ok: rcode === 41 || rcode === 44, code: rcode });
    });
    sock.on('error', (e) => { clearTimeout(to); try{sock.close();}catch{} resolve({ ok: false, error: e.message }); });
    sock.send(packet, opts.port, opts.host, (err) => { if (err) { clearTimeout(to); try{sock.close();}catch{} resolve({ ok:false, error: err.message }); } });
  });

  let last: any = null;
  for (let i = 0; i < 2; i++) {
    last = await once();
    if (last.ok) return last;
  }
  return last;
}
