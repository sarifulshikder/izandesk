import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { dispatchMessage, getChannel, logMessage, sendViaProvider } from '../integrations/messaging';

const router: Router = Router();
function user(req:any){ return req.user || {}; }
function requireMessagingRole(req:any,res:any){
  const role = user(req).role;
  if (!['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'].includes(role)) { res.status(403).json({ message: 'Insufficient permissions for messaging operations' }); return false; }
  return true;
}

router.get('/channels', asyncHandler(async (_req, res) => {
  const r = await pool.query("SELECT id,name,channel_type,provider,enabled,is_default,config,sender_id,notes,updated_at,(credentials IS NOT NULL AND credentials <> '{}'::jsonb) as has_credentials,(webhook_secret IS NOT NULL AND webhook_secret <> '') as has_webhook_secret FROM messaging_channels ORDER BY channel_type, provider, name");
  res.json({ data: r.rows });
}));

router.post('/channels', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req,res)) return;
  const b = req.body || {};
  if (!b.channel_type || !b.provider || !b.name) return res.status(400).json({ message: 'name, channel_type, provider required' });
  const r = await pool.query(`INSERT INTO messaging_channels(name,channel_type,provider,enabled,is_default,config,credentials,webhook_secret,sender_id,notes,updated_at)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,now())
    ON CONFLICT (channel_type, provider, name) DO UPDATE SET enabled=EXCLUDED.enabled,is_default=EXCLUDED.is_default,config=EXCLUDED.config,credentials=COALESCE(EXCLUDED.credentials,messaging_channels.credentials),webhook_secret=COALESCE(EXCLUDED.webhook_secret,messaging_channels.webhook_secret),sender_id=EXCLUDED.sender_id,notes=EXCLUDED.notes,updated_at=now()
    RETURNING id,name,channel_type,provider,enabled,is_default,config,sender_id,notes,updated_at`,
    [b.name,String(b.channel_type).toUpperCase(),String(b.provider).toUpperCase(),!!b.enabled,!!b.is_default,JSON.stringify(b.config||{}),b.credentials?JSON.stringify(b.credentials):null,b.webhook_secret||null,b.sender_id||null,b.notes||null]);
  res.json({ data: r.rows[0] });
}));

router.put('/channels/:id', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req,res)) return;
  const b = req.body || {};
  const r = await pool.query(`UPDATE messaging_channels SET name=COALESCE($1,name), enabled=COALESCE($2,enabled), is_default=COALESCE($3,is_default), config=COALESCE($4::jsonb,config), credentials=COALESCE($5::jsonb,credentials), webhook_secret=COALESCE($6,webhook_secret), sender_id=COALESCE($7,sender_id), notes=$8, updated_at=now() WHERE id=$9 RETURNING id,name,channel_type,provider,enabled,is_default,config,sender_id,notes,updated_at`,
    [b.name,b.enabled,b.is_default,b.config?JSON.stringify(b.config):null,b.credentials?JSON.stringify(b.credentials):null,b.webhook_secret||null,b.sender_id,b.notes||null,req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Channel not found' });
  res.json({ data: r.rows[0] });
}));

router.get('/templates', asyncHandler(async (_req, res) => {
  const r = await pool.query('SELECT * FROM message_templates ORDER BY channel_type, name');
  res.json({ data: r.rows });
}));

router.post('/templates', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req,res)) return;
  const b = req.body || {};
  if (!b.name || !b.channel_type || !b.body) return res.status(400).json({ message: 'name, channel_type, body required' });
  const r = await pool.query(`INSERT INTO message_templates(name,channel_type,purpose,subject,body,variables,is_active,updated_at)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,now())
    ON CONFLICT (name, channel_type) DO UPDATE SET purpose=EXCLUDED.purpose,subject=EXCLUDED.subject,body=EXCLUDED.body,variables=EXCLUDED.variables,is_active=EXCLUDED.is_active,updated_at=now()
    RETURNING *`,
    [b.name,String(b.channel_type).toUpperCase(),b.purpose||null,b.subject||null,b.body,JSON.stringify(b.variables||[]),b.is_active!==false]);
  res.json({ data: r.rows[0] });
}));

router.delete('/templates/:id', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req,res)) return;
  await pool.query('DELETE FROM message_templates WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

router.get('/logs', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req,res)) return;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
  const r = await pool.query('SELECT * FROM message_logs ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json({ data: r.rows });
}));

router.post('/send', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req,res)) return;
  const b = req.body || {};
  try {
    const out = await dispatchMessage({ ...b, requireEnabled: b.requireEnabled === true });
    res.json(out);
  } catch (e:any) {
    // log failed attempt for visibility
    try { await logMessage({ channel_type: b.channel_type || 'UNKNOWN', provider: b.provider || 'UNKNOWN', direction:'OUTBOUND', recipient: b.to||null, subject: b.subject||null, body: b.body||null, status:'FAILED', error_message: e.message, payload: { request: b } }); } catch {}
    res.status(400).json({ ok: false, message: e.message });
  }
}));

router.post('/send-test', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req,res)) return;
  const b = req.body || {};
  try {
    const out = await dispatchMessage({ ...b, related_type: b.related_type || 'TEST', related_id: b.related_id || null, requireEnabled: false });
    res.json(out);
  } catch (e:any) {
    try { await logMessage({ channel_type: b.channel_type || 'UNKNOWN', provider: b.provider || 'UNKNOWN', direction:'OUTBOUND', recipient: b.to||null, subject: b.subject||null, body: b.body||null, status:'FAILED', error_message: e.message, payload: { request: b } }); } catch {}
    res.status(400).json({ ok: false, message: e.message });
  }
}));

export default router;
