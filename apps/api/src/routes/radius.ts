import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { syncSubscriberToRadiusDb, sendCoaPacket } from '../integrations/radius';

const router: Router = Router();

// RADIUS users sync (radcheck/radreply simulation)
router.get('/users', asyncHandler(async (_req, res) => {
  const r = await pool.query(`SELECT ru.*, s.full_name, s.client_code, s.status as subscriber_status, s.package_name
    FROM radius_users ru LEFT JOIN subscribers s ON s.id=ru.subscriber_id ORDER BY ru.updated_at DESC`);
  res.json({ data: r.rows });
}));

router.post('/sync', asyncHandler(async (req, res) => {
  const { subscriber_ids } = req.body || {};
  const subs = subscriber_ids?.length
    ? (await pool.query(`SELECT s.*, bp.profile_name FROM subscribers s LEFT JOIN bandwidth_packages bp ON bp.name=s.package_name WHERE s.id = ANY($1::uuid[]) AND s.username IS NOT NULL AND s.username <> ''`, [subscriber_ids])).rows
    : (await pool.query(`SELECT s.*, bp.profile_name FROM subscribers s LEFT JOIN bandwidth_packages bp ON bp.name=s.package_name WHERE s.username IS NOT NULL AND s.username <> ''`)).rows;
  const results: any[] = [];
  for (const s of subs) {
    const profile = s.profile_name || s.package_name || 'default';
    const status = s.status === 'ACTIVE' ? 'SYNCED' : s.status === 'SUSPENDED' ? 'DISABLED' : 'SYNCED';
    try {
      await syncSubscriberToRadiusDb(s);
      await pool.query(`INSERT INTO radius_users(subscriber_id,username,password,profile,framed_ip_address,status,last_synced_at,last_error)
        VALUES($1,$2,$3,$4,$5,$6,now(),NULL)
        ON CONFLICT (username) DO UPDATE SET subscriber_id=$1,password=COALESCE($3,radius_users.password),profile=$4,framed_ip_address=$5,status=$6,last_synced_at=now(),last_error=NULL,updated_at=now()
        RETURNING *`,
        [s.id, s.username, s.password || null, profile, s.ip_address || null, status]);
      results.push({ username: s.username, status, profile, db: 'radcheck/radreply/radusergroup updated' });
    } catch (e: any) {
      await pool.query(`INSERT INTO radius_users(subscriber_id,username,password,profile,framed_ip_address,status,last_synced_at,last_error)
        VALUES($1,$2,$3,$4,$5,'ERROR',now(),$6)
        ON CONFLICT (username) DO UPDATE SET status='ERROR', last_error=$6, updated_at=now()`,
        [s.id, s.username, s.password || null, profile, s.ip_address || null, e.message || String(e)]);
      results.push({ username: s.username, status: 'ERROR', error: e.message });
    }
  }
  res.json({ ok: true, synced: results.filter(r=>r.status!=='ERROR').length, results, note: 'Synced to FreeRADIUS SQL tables (radcheck/radreply/radusergroup) in IzanDesk DB. Ensure FreeRADIUS service is running and connected to this DB.' });
}));

// CoA / PoD (RFC 3576)
router.post('/coa', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.action) return res.status(400).json({ message: 'username and action are required' });
  const action = String(b.action).toUpperCase(); // DISCONNECT, CHANGE_SPEED, RECONNECT
  const attrs = b.attributes || {};
  let nasInfo = '';
  let routerId = b.router_id || null;
  let rt: any = null;
  if (routerId) {
    const rr = await pool.query('SELECT name, host, integration_mode, radius_secret, coa_port, nas_identifier FROM network_routers WHERE id=$1', [routerId]);
    rt = rr.rows[0];
  }
  // If no router specified, try to pick a RADIUS NAS or subscriber's router
  if (!rt) {
    const sub = await pool.query('SELECT router_id, provisioning_mode FROM subscribers WHERE username=$1 LIMIT 1', [b.username]);
    if (sub.rows[0]?.router_id) {
      routerId = sub.rows[0].router_id;
      const rr = await pool.query('SELECT name, host, integration_mode, radius_secret, coa_port, nas_identifier FROM network_routers WHERE id=$1', [routerId]);
      rt = rr.rows[0];
    } else {
      const rr = await pool.query("SELECT name, host, integration_mode, radius_secret, coa_port, nas_identifier, id FROM network_routers WHERE integration_mode='RADIUS' AND is_enabled=true ORDER BY created_at LIMIT 1");
      rt = rr.rows[0]; if (rt) routerId = rt.id;
    }
  }

  let status = 'QUEUED'; let msg = ''; let coaResult: any = null;
  const canSend = rt && rt.host && rt.radius_secret && (action === 'DISCONNECT' || action === 'CHANGE_SPEED');
  if (canSend) {
    try {
      coaResult = await sendCoaPacket({ host: rt.host, port: Number(rt.coa_port || 3799), secret: String(rt.radius_secret), username: b.username, action: action === 'DISCONNECT' ? 'DISCONNECT' : 'COA', attributes: attrs });
      if (coaResult.ok) { status = 'EXECUTED'; msg = action === 'DISCONNECT' ? 'PoD Disconnect sent and acknowledged by NAS' : 'CoA sent and acknowledged by NAS'; }
      else { status = 'FAILED'; msg = `CoA/PoD sent but no ACK: ${coaResult.error || 'code ' + coaResult.code}`; }
    } catch (e: any) { status = 'FAILED'; msg = `CoA/PoD failed: ${e.message}`; }
  } else if (action === 'RECONNECT') {
    status = 'EXECUTED'; msg = 'Reconnect/profile refresh requested (re-auth via RADIUS on next session).';
  } else {
    status = 'FAILED'; msg = 'No target NAS with host+shared secret+CoA port found. Select a RADIUS router/NAS or assign subscriber to a RADIUS-enabled router.';
  }
  if (rt) nasInfo = ` via NAS ${rt.name} (${rt.host}:${rt.coa_port || 3799})`;
  const response_message = msg + nasInfo;

  const r = await pool.query(`INSERT INTO coa_requests(subscriber_id,username,router_id,action,attributes,status,response_message,executed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *`,
    [b.subscriber_id || null, b.username, routerId || null, action, JSON.stringify(attrs), status, response_message]);
  if (action === 'DISCONNECT' && status === 'EXECUTED') {
    await pool.query("UPDATE subscriber_sessions SET status='OFFLINE', rx_bps=0, tx_bps=0, updated_at=now() WHERE username=$1", [b.username]);
  }
  res.json({ ok: status === 'EXECUTED', request: r.rows[0], message: response_message, coa: coaResult });
}));

router.get('/coa', asyncHandler(async (_req, res) => {
  const r = await pool.query(`SELECT c.*, s.full_name, s.client_code, r.name as router_name FROM coa_requests c
    LEFT JOIN subscribers s ON s.id=c.subscriber_id LEFT JOIN network_routers r ON r.id=c.router_id
    ORDER BY c.created_at DESC LIMIT 100`);
  res.json({ data: r.rows });
}));

export default router;
