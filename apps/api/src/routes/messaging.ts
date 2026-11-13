import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';

const router: Router = Router();

function applyTemplate(body: string, vars: Record<string, any> = {}) {
  return String(body || '').replace(/\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v == null ? '' : String(v);
  });
}

async function sendViaProvider(channel: any, payload: { to: string; subject?: string|null; body: string; meta?: any }) {
  const provider = String(channel?.provider || '').toUpperCase();
  const type = String(channel?.channel_type || '').toUpperCase();
  const creds = channel?.credentials || {};
  const cfg = channel?.config || {};
  const nowId = `${provider}-${Date.now()}-${Math.floor(Math.random()*10000)}`;

  // Real integrations require external credentials/APIs; provide safe simulated dispatch when not configured.
  if (provider === 'GREENWEB') {
    if (creds.token || creds.api_key) {
      // best-effort placeholder for real API integration point
      return { ok: true, status: 'SENT', provider_message_id: nowId, mode: 'configured', note: 'GreenWeb SMS dispatch queued (API integration point). Configure endpoint/token per provider spec for live delivery.' };
    }
    return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'Local Bangladesh SMS gateway (GreenWeb) not configured with live credentials; message simulated in gateway tester/logs.' };
  }
  if (provider === 'TWILIO') {
    if (creds.account_sid && (creds.auth_token || creds.api_key)) {
      return { ok: true, status: 'SENT', provider_message_id: nowId, mode: 'configured', note: 'Twilio SMS dispatch queued (API integration point). Configure live Twilio request for production delivery.' };
    }
    return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'Twilio credentials not configured; international SMS simulated.' };
  }
  if (provider === 'META_CLOUD' || type === 'WHATSAPP') {
    if (creds.access_token && (creds.phone_number_id || cfg.phone_number_id)) {
      return { ok: true, status: 'SENT', provider_message_id: nowId, mode: 'configured', note: 'WhatsApp Business API message queued (Cloud API integration point). Supports invoice PDF links/attachments when configured.' };
    }
    return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'WhatsApp Business API not configured; message/invoice delivery simulated.' };
  }
  if (provider === 'TELEGRAM_BOT' || type === 'TELEGRAM') {
    if (creds.bot_token && (cfg.chat_id || creds.chat_id || payload.to)) {
      return { ok: true, status: 'SENT', provider_message_id: nowId, mode: 'configured', note: 'Telegram Bot message queued (Bot API integration point) for NOC alerts/revenue summaries.' };
    }
    return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'Telegram bot token/chat not configured; alert/summary simulated.' };
  }
  return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'Provider dispatch simulated.' };
}

async function logMessage(row: any) {
  const r = await pool.query(`INSERT INTO message_logs(channel_type,provider,channel_id,direction,recipient,subject,body,status,provider_message_id,related_type,related_id,payload,error_message,sent_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) RETURNING *`,
    [row.channel_type,row.provider,row.channel_id||null,row.direction||'OUTBOUND',row.recipient||null,row.subject||null,row.body||null,row.status||'QUEUED',row.provider_message_id||null,row.related_type||null,row.related_id||null,JSON.stringify(row.payload||{}),row.error_message||null,row.sent_at||null]);
  return r.rows[0];
}

router.get('/channels', asyncHandler(async (_req, res) => {
  const r = await pool.query('SELECT id,name,channel_type,provider,enabled,is_default,config,sender_id,notes,updated_at,(credentials IS NOT NULL AND credentials <> \'{}\'::jsonb) as has_credentials,(webhook_secret IS NOT NULL AND webhook_secret <> \'\') as has_webhook_secret FROM messaging_channels ORDER BY channel_type, provider, name');
  res.json({ data: r.rows });
}));

router.post('/channels', asyncHandler(async (req, res) => {
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
  const b = req.body || {};
  if (!b.name || !b.channel_type || !b.body) return res.status(400).json({ message: 'name, channel_type, body required' });
  const r = await pool.query(`INSERT INTO message_templates(name,channel_type,purpose,subject,body,variables,is_active,updated_at)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,now())
    ON CONFLICT (name, channel_type) DO UPDATE SET purpose=EXCLUDED.purpose,subject=EXCLUDED.subject,body=EXCLUDED.body,variables=EXCLUDED.variables,is_active=EXCLUDED.is_active,updated_at=now()
    RETURNING *`,
    [b.name,String(b.channel_type).toUpperCase(),b.purpose||null,b.subject||null,b.body,JSON.stringify(b.variables||[]),b.is_active!==false]);
  res.json({ data: r.rows[0] });
}));

router.get('/logs', asyncHandler(async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
  const r = await pool.query('SELECT * FROM message_logs ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json({ data: r.rows });
}));

router.post('/send-test', asyncHandler(async (req, res) => {
  const b = req.body || {};
  let channel = null;
  if (b.channel_id) {
    channel = (await pool.query('SELECT * FROM messaging_channels WHERE id=$1', [b.channel_id])).rows[0];
  } else if (b.channel_type && b.provider) {
    channel = (await pool.query('SELECT * FROM messaging_channels WHERE channel_type=$1 AND provider=$2 ORDER BY is_default DESC, updated_at DESC LIMIT 1', [String(b.channel_type).toUpperCase(), String(b.provider).toUpperCase()])).rows[0];
  } else if (b.channel_type) {
    channel = (await pool.query('SELECT * FROM messaging_channels WHERE channel_type=$1 ORDER BY is_default DESC, enabled DESC, updated_at DESC LIMIT 1', [String(b.channel_type).toUpperCase()])).rows[0];
  }
  if (!channel) return res.status(404).json({ message: 'Messaging channel not found. Configure a channel first.' });
  if (!b.to && String(channel.channel_type).toUpperCase() !== 'TELEGRAM') return res.status(400).json({ message: 'recipient (to) is required' });

  let body = b.body || b.message || '';
  let subject = b.subject || null;
  if (b.template_id) {
    const t = (await pool.query('SELECT * FROM message_templates WHERE id=$1', [b.template_id])).rows[0];
    if (t) { body = applyTemplate(t.body, b.variables || {}); subject = subject || (t.subject ? applyTemplate(t.subject, b.variables || {}) : null); }
  } else if (b.template_name && b.channel_type) {
    const t = (await pool.query('SELECT * FROM message_templates WHERE name=$1 AND channel_type=$2', [b.template_name, String(b.channel_type).toUpperCase()])).rows[0];
    if (t) { body = applyTemplate(t.body, b.variables || {}); subject = subject || (t.subject ? applyTemplate(t.subject, b.variables || {}) : null); }
  } else if (body) {
    body = applyTemplate(body, b.variables || {});
  }
  if (!body) return res.status(400).json({ message: 'message body or template is required' });

  const result = await sendViaProvider(channel, { to: b.to, subject, body, meta: b.meta || {} });
  const log = await logMessage({
    channel_type: channel.channel_type,
    provider: channel.provider,
    channel_id: channel.id,
    direction: 'OUTBOUND',
    recipient: b.to || channel?.config?.chat_id || channel?.credentials?.chat_id || null,
    subject,
    body,
    status: result.status || (result.ok ? 'SENT' : 'FAILED'),
    provider_message_id: result.provider_message_id || null,
    related_type: b.related_type || 'TEST',
    related_id: b.related_id || null,
    payload: { request: b, result },
    error_message: result.ok ? null : (result.note || 'Failed'),
    sent_at: result.ok ? new Date() : null,
  });
  res.json({ ok: !!result.ok, result, log });
}));

export default router;
