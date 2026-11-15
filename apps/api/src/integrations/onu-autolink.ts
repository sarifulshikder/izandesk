import { pool } from '../db';
import { oltFindOnuByClientMac } from './olt';
import { syncOnuToInventory } from './onu-inventory-sync';

function normMac(v: any): string | null {
  const m = String(v || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return m.length === 12 ? m.match(/.{2}/g)!.join(':') : null;
}

export type AutoLinkResult = { subscriber_id: string; onu_id: string; method: 'name' | 'fdb_mac' };

function nameTokens(sub: { username?: string | null; client_code?: string | null }): string[] {
  const base = [String(sub.username || '').trim(), String(sub.client_code || '').trim()].filter((x) => x.length >= 3);
  // extract word tokens from the username, splitting on separators AND letter/digit boundaries,
  // e.g. "Ac025Amina" -> "amina", "idc022@nazmul" -> "nazmul", "mostafiz9513" -> "mostafiz"
  // so ONU descriptions like "Amina" / "Nazmul" still match; min length 4 to avoid noisy short tokens
  const words = String(sub.username || '')
    .toLowerCase()
    .split(/[^a-z0-9]+|(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/)
    .filter((w) => w.length >= 4);
  return Array.from(new Set([...base, ...words]));
}

async function findByName(sub: { id: string; username?: string | null; client_code?: string | null }): Promise<string | null> {
  const tokens = nameTokens(sub);
  if (!tokens.length) return null;
  const ors = tokens.map((_, i) => `(o.name ILIKE $${i + 2} OR o.serial_number ILIKE $${i + 2})`).join(' OR ');
  const params: any[] = [sub.id, ...tokens.map((t) => `%${t}%`)];
  const cand = await pool.query(
    `SELECT o.id, o.name, o.serial_number, o.status, o.subscriber_id FROM onus o
     WHERE (o.subscriber_id IS NULL OR o.subscriber_id = $1) AND (${ors})
     ORDER BY o.updated_at DESC NULLS LAST LIMIT 20`,
    params
  );
  if (!cand.rows.length) return null;
  // already linked to this subscriber -> keep
  const self = cand.rows.find((r: any) => r.subscriber_id === sub.id);
  if (self) return self.id;
  const unlinked = cand.rows.filter((r: any) => !r.subscriber_id);
  if (!unlinked.length) return null;
  // score: exact name/serial match (100) > substring match (50), +10 if ONU is ONLINE
  const scored = unlinked
    .map((r: any) => {
      const name = String(r.name || '').trim().toLowerCase();
      const serial = String(r.serial_number || '').trim().toLowerCase();
      let score = 0;
      for (const t of tokens) {
        const tl = t.toLowerCase();
        if (name === tl || serial === tl.replace(/\s+/g, '_')) score += 100;
        else if (name.includes(tl) || serial.includes(tl)) score += 50;
      }
      if (String(r.status || '').toUpperCase() === 'ONLINE') score += 10;
      return { id: r.id, score };
    })
    .sort((a, b) => b.score - a.score);
  // ambiguous if tie at the top; require a real match (>= 50)
  if (scored.length >= 2 && scored[0].score === scored[1].score) return null;
  if (scored[0].score >= 50) return scored[0].id;
  return null;
}

async function findByFdbMac(mac: string): Promise<string | null> {
  const sessionMac = normMac(mac);
  if (!sessionMac) return null;
  const olts = (await pool.query("SELECT id, host, vendor, model, snmp_community, snmp_port, is_enabled FROM olts WHERE is_enabled = true ORDER BY updated_at DESC NULLS LAST")).rows;
  for (const olt of olts) {
    try {
      const hit = await oltFindOnuByClientMac(olt as any, sessionMac) as any;
      if (!hit?.ok) continue;
      let onuRow: any = null;
      if (hit.pon_port && hit.onu_id) {
        const r = await pool.query('SELECT id, subscriber_id FROM onus WHERE olt_id=$1 AND pon_port=$2 AND onu_id=$3 LIMIT 1', [olt.id, hit.pon_port, String(hit.onu_id)]);
        onuRow = r.rows[0] || null;
      }
      if (!onuRow && hit.ifName) {
        const r = await pool.query('SELECT id, subscriber_id FROM onus WHERE olt_id=$1 AND (name=$2 OR serial_number=$3) LIMIT 1', [olt.id, hit.ifName, String(hit.ifName).replace(/\s+/g, '_')]);
        onuRow = r.rows[0] || null;
      }
      if (onuRow) return onuRow.id;
    } catch {}
  }
  return null;
}

export async function autoLinkOnuForSubscriber(subscriberId: string, opts?: { mac?: string | null; allowFdb?: boolean }): Promise<AutoLinkResult | null> {
  const subRes = await pool.query('SELECT id, username, client_code, mac_address FROM subscribers WHERE id=$1', [subscriberId]);
  const sub = subRes.rows[0];
  if (!sub) return null;

  // if already linked, nothing to do
  const existing = await pool.query('SELECT id FROM onus WHERE subscriber_id=$1 LIMIT 1', [subscriberId]);
  if (existing.rows[0]) return null;

  // 1) name/client_code heuristic
  const byName = await findByName(sub);
  if (byName) {
    const ok = await pool.query("UPDATE onus SET subscriber_id=$1, updated_at=now() WHERE id=$2 AND subscriber_id IS NULL RETURNING id", [subscriberId, byName]);
    if (ok.rows[0]) {
      // trick: auto-import linked ONU into inventory & serial tracking
      try { await syncOnuToInventory(byName); } catch {}
      return { subscriber_id: subscriberId, onu_id: byName, method: 'name' };
    }
  }

  // 2) FDB MAC correlation
  if (opts?.allowFdb !== false) {
    let mac = normMac(opts?.mac || sub.mac_address);
    if (!mac) {
      try {
        const s = await pool.query("SELECT mac_address, ip_address FROM subscriber_sessions WHERE subscriber_id=$1 AND status='ONLINE' ORDER BY updated_at DESC LIMIT 1", [subscriberId]);
        mac = normMac(s.rows[0]?.mac_address);
      } catch {}
    }
    if (mac) {
      const byMac = await findByFdbMac(mac);
      if (byMac) {
        // ensure not linked to different subscriber
        const chk = await pool.query('SELECT subscriber_id FROM onus WHERE id=$1', [byMac]);
        const cur = chk.rows[0];
        if (cur && !cur.subscriber_id) {
          await pool.query("UPDATE onus SET subscriber_id=$1, updated_at=now() WHERE id=$2 AND subscriber_id IS NULL", [subscriberId, byMac]);
          // trick: auto-import linked ONU into inventory & serial tracking
          try { await syncOnuToInventory(byMac); } catch {}
          return { subscriber_id: subscriberId, onu_id: byMac, method: 'fdb_mac' };
        } else if (cur && cur.subscriber_id === subscriberId) {
          // already linked — ensure inventory import exists
          try { await syncOnuToInventory(byMac); } catch {}
          return { subscriber_id: subscriberId, onu_id: byMac, method: 'fdb_mac' };
        }
      }
    }
  }

  return null;
}

export async function autoLinkOnusBulk(opts?: { allowFdb?: boolean; limit?: number }): Promise<{ linked: AutoLinkResult[]; checked: number }> {
  const limit = Math.max(1, Math.min(Number(opts?.limit || 200), 1000));
  // subscribers without linked ONU but with username/client_code or an online session mac
  const subs = (await pool.query(
    `SELECT s.id, s.username, s.client_code, s.mac_address,
            (SELECT ss.mac_address FROM subscriber_sessions ss WHERE ss.subscriber_id=s.id AND ss.status='ONLINE' ORDER BY ss.updated_at DESC LIMIT 1) as session_mac
     FROM subscribers s
     WHERE NOT EXISTS (SELECT 1 FROM onus o WHERE o.subscriber_id = s.id)
       AND (s.username IS NOT NULL OR s.client_code IS NOT NULL)
     ORDER BY s.updated_at DESC NULLS LAST
     LIMIT $1`, [limit]
  )).rows;
  const linked: AutoLinkResult[] = [];
  for (const s of subs) {
    try {
      const res = await autoLinkOnuForSubscriber(s.id, { mac: s.session_mac || s.mac_address, allowFdb: opts?.allowFdb });
      if (res) linked.push(res);
    } catch {}
  }
  return { linked, checked: subs.length };
}
