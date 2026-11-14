import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type OltRow = any;

function hasBin(cmd: string): Promise<boolean> {
  return execFileAsync('sh', ['-lc', `command -v ${cmd}`]).then(() => true).catch(() => false);
}

async function dockerExecSnmp(args: string[], timeoutSec = 6): Promise<string> {
  // Tunnel-aware execution: run inside wg-hub (has WG routes/tools when installed)
  const hostArg = args.find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a) || (a && !a.startsWith('-') && a.includes('.') && !a.startsWith('.')));
  // ensure route for target host in wg-hub if provided in args
  const routeCmd = hostArg ? `ip route replace ${hostArg}/32 dev ${process.env.WG_INTERFACE || 'wg0'} 2>/dev/null || true; ` : '';
  const cmd = routeCmd + args.map(a => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ');
  const container = process.env.WG_HUB_CONTAINER || 'izandesk-wg-hub';
  const { stdout } = await execFileAsync('docker', ['exec', container, 'sh', '-lc', cmd], { timeout: (timeoutSec + 4) * 1000, maxBuffer: 4 * 1024 * 1024 });
  return String(stdout || '');
}

async function runSnmp(bin: 'snmpget'|'snmpwalk'|'snmpbulkwalk', args: string[], timeoutSec = 5): Promise<string> {
  // local first
  if (await hasBin(bin)) {
    try {
      const { stdout } = await execFileAsync(bin, args, { timeout: (timeoutSec + 2) * 1000, maxBuffer: 4 * 1024 * 1024 });
      return String(stdout || '');
    } catch (e) {
      // fall through to tunnel exec
    }
  }
  // tunnel-aware fallback via wg-hub (requires docker CLI + socket access to host)
  try {
    return await dockerExecSnmp([bin, ...args], timeoutSec);
  } catch (e) {
    throw new Error(`SNMP unavailable locally and tunnel exec failed (${bin}): ${(e as any).message || e}`);
  }
}

async function snmpWalk(host: string, community: string, oid: string, timeoutSec = 5): Promise<string[]> {
  const bins: ('snmpbulkwalk'|'snmpwalk')[] = ['snmpbulkwalk', 'snmpwalk'];
  let lastErr: any;
  for (const bin of bins) {
    try {
      const args = ['-v2c', '-c', community || 'public', '-t', String(timeoutSec), '-r', '0', '-Oqn', host, oid];
      const out = await runSnmp(bin, args, timeoutSec);
      const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(l => !isSnmpErrorLine(l));
      if (lines.length) return lines;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function snmpGet(host: string, community: string, oids: string[], timeoutSec = 4): Promise<Record<string,string>> {
  const args = ['-v2c', '-c', community || 'public', '-t', String(timeoutSec), '-r', '0', '-Oqn', host, ...oids];
  const out = await runSnmp('snmpget', args, timeoutSec);
  const res: Record<string,string> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(.*)$/);
    if (m) res[m[1]] = m[2].replace(/^"|"$/g, '').trim();
  }
  return res;
}

function parseIfNameLine(line: string): { oid: string; ifIndex: number; name: string } | null {
  // .1.3.6.1.2.1.31.1.1.1.1.15 EPON01ONU1 Joshim_shop
  const m = line.match(/^(\.1\.3\.6\.1\.2\.1\.31\.1\.1\.1\.1\.(\d+))\s+(.*)$/);
  if (!m) return null;
  return { oid: m[1], ifIndex: Number(m[2]), name: m[3].replace(/^"|"$/g, '').trim() };
}
function parseOperLine(line: string): { ifIndex: number; status: number } | null {
  // .1.3.6.1.2.1.2.2.1.8.15 up  OR integer 1/2
  const m = line.match(/^\.1\.3\.6\.1\.2\.1\.2\.2\.1\.8\.(\d+)\s+(.*)$/);
  if (!m) return null;
  const v = m[2].toLowerCase();
  const status = v.includes('up') ? 1 : v.includes('down') ? 2 : (parseInt(v,10) || 0);
  return { ifIndex: Number(m[1]), status };
}

function parseVsolEponOnu(ifName: string): { pon: string; onuId: string } | null {
  // VSOL style: EPON01ONU1 Joshim_shop, EPON0/1ONU1, etc.
  const s = String(ifName || '');
  let m = s.match(/EPON0?(\d+)\/?ONU\s*0*(\d+)/i) || s.match(/EPON0?(\d+)ONU0*(\d+)/i);
  if (m) return { pon: `EPON0/${m[1]}`, onuId: String(Number(m[2])) };
  m = s.match(/EPON\s*0?(\d+)[^\d]+ONU\s*0*(\d+)/i);
  if (m) return { pon: `EPON0/${m[1]}`, onuId: String(Number(m[2])) };
  // BDCOM/CDATA style: EPON0/1:3 (PON:ONU)
  m = s.match(/EPON\s*0?(\d+)\s*\/\s*(\d+)\s*:\s*(\d+)/i);
  if (m) return { pon: `EPON0/${m[2]}`, onuId: String(Number(m[3])) };
  m = s.match(/EPON\s*0?(\d+)\s*:\s*(\d+)/i);
  if (m) return { pon: `EPON0/${m[1]}`, onuId: String(Number(m[2])) };
  // GPON style: GPON0/1:3
  m = s.match(/GPON\s*0?(\d+)\s*\/\s*(\d+)\s*:\s*(\d+)/i);
  if (m) return { pon: `GPON0/${m[2]}`, onuId: String(Number(m[3])) };
  m = s.match(/GPON\s*0?(\d+)\s*:\s*(\d+)/i);
  if (m) return { pon: `GPON0/${m[1]}`, onuId: String(Number(m[2])) };
  return null;
}

function isSnmpErrorLine(line: string): boolean {
  const s = String(line || '');
  return /No Such (Object|Instance)/i.test(s) || /No more variables left/i.test(s) || /=\s*(No Such|NULL)?\s*$/i.test(s) && /No Such/i.test(s);
}

function parseDbm(val: string): number | null {
  const s = String(val || '');
  const m = s.match(/\((-?[0-9]+(?:\.[0-9]+)?)\s*dBm\)/i) || s.match(/(-?[0-9]+(?:\.[0-9]+)?)\s*dBm/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

async function vsolOpticalMap(host: string, community: string): Promise<Map<string, { rx: number|null, tx: number|null }>> {
  const map = new Map<string, { rx: number|null, tx: number|null }>();
  try {
    // VSOL V1600D EPON ONU diag table: ...37950.1.1.5.12.2.1.8.1.<col>.<pon>.<onu>
    // col 6: TX power "x mW (y dBm)", col 7: RX power "x mW (y dBm)"
    const txLines = await snmpWalk(host, community, '.1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.6', 6);
    const rxLines = await snmpWalk(host, community, '.1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.7', 6);
    const keyFromOid = (oid: string) => {
      const m = oid.match(/\.1\.3\.6\.1\.4\.1\.37950\.1\.1\.5\.12\.2\.1\.8\.1\.\d+\.(\d+)\.(\d+)/);
      return m ? `EPON0/${m[1]}|${String(Number(m[2]))}` : null;
    };
    for (const line of txLines) {
      const m = line.match(/^(\S+)\s+(.*)$/); if (!m) continue;
      const k = keyFromOid(m[1]); if (!k) continue;
      const cur = map.get(k) || { rx: null, tx: null };
      cur.tx = parseDbm(m[2].replace(/^"|"$/g,''));
      map.set(k, cur);
    }
    for (const line of rxLines) {
      const m = line.match(/^(\S+)\s+(.*)$/); if (!m) continue;
      const k = keyFromOid(m[1]); if (!k) continue;
      const cur = map.get(k) || { rx: null, tx: null };
      cur.rx = parseDbm(m[2].replace(/^"|"$/g,''));
      map.set(k, cur);
    }
  } catch {}
  return map;
}

async function vsolMacMap(host: string, community: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    // VSOL auth/ONU table: ...37950.1.1.5.12.1.9.1.<col>.<idx>  col2=pon, col3=onuId, col5=mac
    const ponLines = await snmpWalk(host, community, '.1.3.6.1.4.1.37950.1.1.5.12.1.9.1.2', 5);
    const onuLines = await snmpWalk(host, community, '.1.3.6.1.4.1.37950.1.1.5.12.1.9.1.3', 5);
    const macLines = await snmpWalk(host, community, '.1.3.6.1.4.1.37950.1.1.5.12.1.9.1.5', 5);
    const idxVal = (lines: string[], prefix: string) => {
      const m = new Map<string,string>();
      for (const line of lines) {
        const mm = line.match(new RegExp('^(' + prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\.(\\d+))\\s+(.*)$'));
        if (mm) m.set(mm[2], mm[3].replace(/^"|"$/g,'').trim());
      }
      return m;
    };
    const p = idxVal(ponLines, '.1.3.6.1.4.1.37950.1.1.5.12.1.9.1.2');
    const o = idxVal(onuLines, '.1.3.6.1.4.1.37950.1.1.5.12.1.9.1.3');
    const mac = idxVal(macLines, '.1.3.6.1.4.1.37950.1.1.5.12.1.9.1.5');
    for (const [idx, pon] of p.entries()) {
      const onu = o.get(idx); const maddr = mac.get(idx);
      if (!onu || !maddr) continue;
      map.set(`EPON0/${String(Number(pon))}|${String(Number(onu))}`, maddr.toLowerCase());
    }
  } catch {}
  return map;
}

function parseHexMac(val: string): string | null {
  const s = String(val || '').replace(/^"|"$/g,'').trim();
  // Hex-STRING: A0 7E 07 01 B9 59  OR A0:7E:...
  let m = s.match(/Hex-STRING:\s*([0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2}){5})/i) || s.match(/([0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2}){5})/);
  if (m) return m[1].trim().toLowerCase().replace(/\s+/g, ':');
  m = s.match(/([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})/);
  if (m) return m[1].toLowerCase();
  return null;
}

async function bdcomMacMap(host: string, community: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    // BDCOM P3310C/EPON: ...3320.101.10.1.1.3.<ifIndex> = Hex-STRING MAC
    const lines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.10.1.1.3', 6);
    for (const line of lines) {
      const m = line.match(/^\.1\.3\.6\.1\.4\.1\.3320\.101\.10\.1\.1\.3\.(\d+)\s+(.*)$/);
      if (!m) continue;
      const mac = parseHexMac(m[2]);
      if (mac) map.set(Number(m[1]), mac);
    }
  } catch {}
  return map;
}

async function bdcomOpticalRxMap(host: string, community: string): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  try {
    // BDCOM EPON (observed P3310C): ...3320.101.10.5.1.5.<ifIndex> = INTEGER in 0.1 dBm (e.g. -157 => -15.7 dBm)
    const lines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.10.5.1.5', 6);
    for (const line of lines) {
      const m = line.match(/^\.1\.3\.6\.1\.4\.1\.3320\.101\.10\.5\.1\.5\.(\d+)\s+(-?\d+)/);
      if (!m) continue;
      const v = Number(m[2]);
      if (!Number.isFinite(v)) continue;
      // filter obvious invalid/sentinel values
      if (v <= -3000 || v >= 3000) continue;
      map.set(Number(m[1]), +(v / 10).toFixed(2));
    }
  } catch {}
  return map;
}

async function bdcomDescMap(host: string, community: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    // BDCOM ONU auth/LLID table: ...3320.101.11.1.1.<col>.<ponIfIndex>.<mac-octets>
    // col1 = PON ifIndex (15->EPON0/1,16->EPON0/2,17->EPON0/3,18->EPON0/4), col2 = ONU ID, col4 = description/name
    const ponLines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.11.1.1.1', 6);
    const onuLines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.11.1.1.2', 6);
    const nameLines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.11.1.1.4', 6);
    const suffixVal = (lines: string[], prefix: string) => {
      const m = new Map<string,string>();
      for (const line of lines) {
        const mm = line.match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\.(.+?)\\s+(.*)$'));
        if (mm) m.set(mm[1], mm[2].replace(/^"|"$/g,'').trim());
      }
      return m;
    };
    const p = suffixVal(ponLines, '.1.3.6.1.4.1.3320.101.11.1.1.1');
    const o = suffixVal(onuLines, '.1.3.6.1.4.1.3320.101.11.1.1.2');
    const n = suffixVal(nameLines, '.1.3.6.1.4.1.3320.101.11.1.1.4');
    const ponName = (ifIdx: number) => ({15:'EPON0/1',16:'EPON0/2',17:'EPON0/3',18:'EPON0/4'} as any)[ifIdx] || null;
    for (const [sfx, ponIf] of p.entries()) {
      const onuId = o.get(sfx); const name = n.get(sfx);
      if (!onuId || !name) continue;
      const port = ponName(Number(ponIf));
      if (!port) continue;
      map.set(`${port}|${String(Number(onuId))}`, name);
    }
  } catch {}
  return map;
}

function parseBdcomDateTime(hexStr: string): string | null {
  const bytes = String(hexStr || '').replace(/Hex-STRING:\s*/i,'').replace(/^"|"$/g,'').trim().split(/\s+/).filter(Boolean).map(b => parseInt(b,16));
  if (bytes.length < 7 || bytes.some(b => !Number.isFinite(b)) || bytes.every(b => b === 0)) return null;
  const y = (bytes[0] << 8) | bytes[1];
  const mo = bytes[2], d = bytes[3], h = bytes[4], mi = bytes[5], se = bytes[6];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n:number)=>String(n).padStart(2,'0');
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(se)}`;
}

async function bdcomDistanceMap(host: string, community: string): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  try {
    // BDCOM P3310C (observed, best-effort): ...3320.101.10.5.1.2.<ifIndex> distance/RTT, interpreted as 0.1 m
    const lines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.10.5.1.2', 6);
    for (const line of lines) {
      const m = line.match(/^\.1\.3\.6\.1\.4\.1\.3320\.101\.10\.5\.1\.2\.(\d+)\s+(\d+)/);
      if (!m) continue;
      const v = Number(m[2]);
      if (!Number.isFinite(v) || v <= 0 || v > 200000) continue;
      map.set(Number(m[1]), Math.round(v / 10));
    }
  } catch {}
  return map;
}

async function bdcomTxMap(host: string, community: string): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  try {
    // BDCOM P3310C (observed, best-effort candidate): ...3320.101.10.5.1.6.<ifIndex> ONU Tx in 0.1 dBm
    const lines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.10.5.1.6', 6);
    for (const line of lines) {
      const m = line.match(/^\.1\.3\.6\.1\.4\.1\.3320\.101\.10\.5\.1\.6\.(\d+)\s+(-?\d+)/);
      if (!m) continue;
      const v = Number(m[2]);
      if (!Number.isFinite(v) || v < -400 || v > 400) continue;
      map.set(Number(m[1]), +(v / 10).toFixed(2));
    }
  } catch {}
  return map;
}

async function bdcomLastDownMap(host: string, community: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    // BDCOM ONU auth/LLID table: col10 appears to be last dereg/offline time (DateAndTime-like hex), best-effort
    const ponLines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.11.1.1.1', 6);
    const onuLines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.11.1.1.2', 6);
    const downLines = await snmpWalk(host, community, '.1.3.6.1.4.1.3320.101.11.1.1.10', 6);
    const suffixVal = (lines: string[], prefix: string) => {
      const m = new Map<string,string>();
      for (const line of lines) {
        const mm = line.match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\.(.+?)\\s+(.*)$'));
        if (mm) m.set(mm[1], mm[2].replace(/^"|"$/g,'').trim());
      }
      return m;
    };
    const p = suffixVal(ponLines, '.1.3.6.1.4.1.3320.101.11.1.1.1');
    const o = suffixVal(onuLines, '.1.3.6.1.4.1.3320.101.11.1.1.2');
    const d = suffixVal(downLines, '.1.3.6.1.4.1.3320.101.11.1.1.10');
    const ponName = (ifIdx: number) => ({15:'EPON0/1',16:'EPON0/2',17:'EPON0/3',18:'EPON0/4'} as any)[ifIdx] || null;
    for (const [sfx, ponIf] of p.entries()) {
      const onuId = o.get(sfx); const raw = d.get(sfx);
      if (!onuId || !raw) continue;
      const port = ponName(Number(ponIf));
      if (!port) continue;
      const dt = parseBdcomDateTime(raw);
      if (dt) map.set(`${port}|${String(Number(onuId))}`, dt);
    }
  } catch {}
  return map;
}

export async function oltTest(olt: OltRow) {
  const host = String(olt.host || '').trim();
  const community = String(olt.snmp_community || 'public');
  try {
    const vals = await snmpGet(host, community, ['.1.3.6.1.2.1.1.1.0', '.1.3.6.1.2.1.1.5.0', '.1.3.6.1.2.1.1.3.0'], 4);
    const sysDescr = vals['.1.3.6.1.2.1.1.1.0'] || null;
    const sysName = vals['.1.3.6.1.2.1.1.5.0'] || null;
    const uptime = vals['.1.3.6.1.2.1.1.3.0'] || null;
    return { ok: true, mode: 'snmp', sysDescr, sysName, uptime };
  } catch (e: any) {
    return { ok: false, mode: 'simulated', error: e.message || String(e) };
  }
}

export async function oltDiscoverOnus(olt: OltRow) {
  const host = String(olt.host || '').trim();
  const community = String(olt.snmp_community || 'public');
  const vendor = String(olt.vendor || '').toUpperCase();
  try {
    // VSOL/EPON and generic IF-MIB based discovery (works for V1600D and similar that expose EPONxxONUyy in ifName)
    const ifNames = await snmpWalk(host, community, '.1.3.6.1.2.1.31.1.1.1.1', 6);
    let oper: string[] = [];
    try { oper = await snmpWalk(host, community, '.1.3.6.1.2.1.2.2.1.8', 5); } catch {}
    const operMap = new Map<number, number>();
    for (const l of oper) { const p = parseOperLine(l); if (p) operMap.set(p.ifIndex, p.status); }

    const onus: any[] = [];
    for (const line of ifNames) {
      const p = parseIfNameLine(line);
      if (!p) continue;
      const ep = parseVsolEponOnu(p.name);
      if (!ep) continue;
      const st = operMap.get(p.ifIndex);
      const status = st === 1 ? 'ONLINE' : st === 2 ? 'OFFLINE' : 'DISCOVERED';
      onus.push({
        pon_port: ep.pon,
        onu_id: ep.onuId,
        serial_number: p.name.replace(/\s+/g, '_').slice(0, 64),
        name: p.name,
        status,
        rx_power_dbm: null,
        tx_power_dbm: null,
        if_index: p.ifIndex,
      });
    }
    if (onus.length) {
      const modelU = String(olt.model||'').toUpperCase();
      const isVsol = vendor.includes('VSOL') || modelU.includes('V1600') || String(olt.model||'').toLowerCase().includes('epon-olt');
      const isBdcom = vendor.includes('BDCOM') || modelU.includes('P3310') || modelU.includes('BDCOM');
      if (isVsol) {
        const [optMap, macMap] = await Promise.all([vsolOpticalMap(host, community), vsolMacMap(host, community)]);
        for (const o of onus) {
          const k = `${o.pon_port}|${o.onu_id}`;
          const opt = optMap.get(k);
          if (opt) { if (opt.rx != null) o.rx_power_dbm = opt.rx; if (opt.tx != null) o.tx_power_dbm = opt.tx; }
          const mac = macMap.get(k);
          if (mac) { o.mac_address = mac; }
        }
      } else if (isBdcom) {
        const [macMap, rxMap, descMap, distMap, txMap, downMap] = await Promise.all([bdcomMacMap(host, community), bdcomOpticalRxMap(host, community), bdcomDescMap(host, community), bdcomDistanceMap(host, community), bdcomTxMap(host, community), bdcomLastDownMap(host, community)]);
        for (const o of onus) {
          const idx = o.if_index;
          if (idx != null) {
            const mac = macMap.get(Number(idx));
            if (mac) o.mac_address = mac;
            const rx = rxMap.get(Number(idx));
            if (rx != null) o.rx_power_dbm = rx;
            const tx = txMap.get(Number(idx));
            if (tx != null) o.tx_power_dbm = tx;
            const dist = distMap.get(Number(idx));
            if (dist != null) (o as any).distance_m = dist;
          }
          const k = `${o.pon_port}|${o.onu_id}`;
          const desc = descMap.get(k);
          if (desc) o.name = desc;
          const ld = downMap.get(k);
          if (ld) (o as any).last_down_cause = `Last down: ${ld}`;
        }
      }
      const note = isVsol
        ? 'Discovered via IF-MIB (EPON ONU interfaces) with VSOL optical/MAC enrichment (best-effort).'
        : isBdcom
          ? 'Discovered via IF-MIB (EPON ONU interfaces) with BDCOM MAC/RX/TX/distance/name enrichment (best-effort, vendor MIB).'
          : 'Discovered via IF-MIB (EPON ONU interfaces)';
      return { ok: true, mode: 'snmp', onus, note };
    }

    // Fallback: try vendor enterprise walks (best-effort)
    const candidateOids = vendor.includes('VSOL') || String(olt.model||'').toUpperCase().includes('V1600')
      ? ['.1.3.6.1.4.1.37950.1.1.5.12', '.1.3.6.1.4.1.37950.1.1.5.10']
      : ['.1.3.6.1.4.1.2011.6.128.1.1.2.43.1.3', '.1.3.6.1.4.1.3320.101.10.1.1.3'];
    for (const oid of candidateOids) {
      try {
        const lines = await snmpWalk(host, community, oid, 5);
        if (lines.length) {
          return { ok: true, mode: 'snmp', onus: lines.slice(0, 64).map((v, i) => {
            const sn = String(v.split(/\s+/).slice(1).join(' ') || v).replace(/[^A-Za-z0-9]/g, '').toUpperCase() || `ONU${i+1}`;
            return { pon_port: `0/1/${(i%8)+1}`, onu_id: String(i+1), serial_number: sn.slice(0,16), name: `Discovered-${sn.slice(-4) || i+1}`, status: 'DISCOVERED', rx_power_dbm: null, tx_power_dbm: null };
          }), note: `Discovered via enterprise OID ${oid}` };
        }
      } catch {}
    }
    return { ok: false, mode: 'snmp', error: 'SNMP reachable but no ONU table matched (no EPON ONU interfaces found)' };
  } catch (e: any) {
    // Simulated fallback
    const discovered = [];
    for (let i=0; i<3; i++) {
      const pon = `0/1/${Math.floor(Math.random()*8)+1}`;
      const sn = `${String(olt.vendor||'ONU').substring(0,4).toUpperCase()}${Math.random().toString(16).substring(2,10).toUpperCase()}`;
      const rx = -(18 + Math.random()*8);
      const tx = +(1 + Math.random()*3);
      discovered.push({ pon_port: pon, onu_id: String(Math.floor(Math.random()*64)), serial_number: sn, name: `Unconfigured-${sn.slice(-4)}`, status: 'DISCOVERED', rx_power_dbm: +rx.toFixed(2), tx_power_dbm: +tx.toFixed(2) });
    }
    return { ok: true, mode: 'simulated', onus: discovered, note: e.message };
  }
}

export async function oltRefreshTelemetry(olt: OltRow, onus: any[]) {
  const host = String(olt.host || '').trim();
  const community = String(olt.snmp_community || 'public');
  const vendor = String(olt.vendor || '').toUpperCase();
  // Best-effort: for IF-MIB discovered ONUs, refresh online/offline and vendor optical/MAC where mapped
  try {
    const ifNames = await snmpWalk(host, community, '.1.3.6.1.2.1.31.1.1.1.1', 6);
    const oper = await snmpWalk(host, community, '.1.3.6.1.2.1.2.2.1.8', 5).catch(()=>[]);
    const operMap = new Map<number, number>();
    for (const l of oper) { const p = parseOperLine(l); if (p) operMap.set(p.ifIndex, p.status); }
    const nameToStatus = new Map<string, string>();
    const nameToIf = new Map<string, number>();
    for (const line of ifNames) {
      const p = parseIfNameLine(line); if (!p) continue;
      const st = operMap.get(p.ifIndex);
      nameToStatus.set(p.name, st === 1 ? 'ONLINE' : st === 2 ? 'OFFLINE' : 'DISCOVERED');
      nameToIf.set(p.name, p.ifIndex);
    }
    const modelU = String(olt.model||'').toUpperCase();
    const isVsol = vendor.includes('VSOL') || modelU.includes('V1600') || String(olt.model||'').toLowerCase().includes('epon-olt');
    const isBdcom = vendor.includes('BDCOM') || modelU.includes('P3310') || modelU.includes('BDCOM');
    let optMap = new Map<string, { rx: number|null, tx: number|null }>();
    let bdRx = new Map<number, number>();
    let bdMac = new Map<number, string>();
    if (isVsol) optMap = await vsolOpticalMap(host, community);
    let bdDist = new Map<number, number>(); let bdTx = new Map<number, number>(); let bdDown = new Map<string, string>();
    if (isBdcom) { [bdRx, bdMac, bdDist, bdTx, bdDown] = await Promise.all([bdcomOpticalRxMap(host, community), bdcomMacMap(host, community), bdcomDistanceMap(host, community), bdcomTxMap(host, community), bdcomLastDownMap(host, community)]); }
    return { ok: true, mode: 'snmp', onus: onus.map(o => {
      let status = nameToStatus.get(String(o.name||'')) || nameToStatus.get(String(o.serial_number||''));
      if (!status) {
        for (const [n,s] of nameToStatus.entries()) { if (n.replace(/\s+/g,'_') === String(o.serial_number||'')) { status = s; break; } }
      }
      const ifIdx = nameToIf.get(String(o.name||'')) ?? nameToIf.get(String(o.serial_number||'').replace(/_/g,' '));
      const opt = optMap.get(`${o.pon_port}|${o.onu_id}`);
      const rx = opt?.rx ?? (ifIdx != null ? bdRx.get(ifIdx) : undefined) ?? o.rx_power_dbm ?? null;
      const tx = opt?.tx ?? (ifIdx != null ? bdTx.get(ifIdx) : undefined) ?? o.tx_power_dbm ?? null;
      const mac = (o as any).mac_address ?? (ifIdx != null ? bdMac.get(ifIdx) : undefined) ?? null;
      const dist = (ifIdx != null ? bdDist.get(ifIdx) : undefined) ?? (o as any).distance_m ?? null;
      const ld = bdDown.get(`${o.pon_port}|${o.onu_id}`) ?? null;
      const lastDown = ld ? `Last down: ${ld}` : ((o as any).last_down_cause ?? null);
      return { id: o.id, status: status || o.status, rx_power_dbm: rx, tx_power_dbm: tx, mac_address: mac, distance_m: dist, last_down_cause: lastDown };
    }) };
  } catch (e: any) {
    return { ok: true, mode: 'simulated', reason: e.message, onus: onus.map(o => ({ id: o.id, status: o.status, rx_power_dbm: o.rx_power_dbm ?? -(17 + Math.random()*12), tx_power_dbm: o.tx_power_dbm ?? +(0.5 + Math.random()*3.5) })) };
  }
}
