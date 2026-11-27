import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { dispatchMessage, getChannel, logMessage, sendViaProvider } from '../integrations/messaging';
import { encryptCredentialsObject, encryptSecretValue, decryptCredentialsObject } from '../security/secret-store';
import {
  getTelegramMe, getTelegramChat, getTelegramUpdates, getTelegramWebhookInfo,
  setTelegramWebhook, deleteTelegramWebhook, sendTelegramChatAction,
  sendTelegramPhoto, sendTelegramDocument, sendTelegramLocation,
} from '../integrations/telegram';

const router: Router = Router();
function user(req:any){ return req.user || {}; }
function requireMessagingRole(req:any,res:any){
  const role = user(req).role;
  if (!['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'].includes(role)) { res.status(403).json({ message: 'Insufficient permissions for messaging operations' }); return false; }
  return true;
}

router.get('/channels', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const r = await pool.query("SELECT id,name,channel_type,provider,enabled,is_default,config,sender_id,notes,updated_at,(credentials IS NOT NULL AND credentials <> '{}'::jsonb) as has_credentials,(webhook_secret IS NOT NULL AND webhook_secret <> '') as has_webhook_secret FROM messaging_channels ORDER BY channel_type, provider, name");
  res.json({ data: r.rows });
}));

router.post('/channels', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req,res)) return;
  const b = req.body || {};
  if (!b.channel_type || !b.provider || !b.name) return res.status(400).json({ message: 'name, channel_type, provider required' });
  const encCreds = b.credentials ? encryptCredentialsObject(b.credentials) : null;
  const encHook = encryptSecretValue(b.webhook_secret);
  const r = await pool.query(`INSERT INTO messaging_channels(name,channel_type,provider,enabled,is_default,config,credentials,webhook_secret,sender_id,notes,updated_at)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,now())
    ON CONFLICT (channel_type, provider, name) DO UPDATE SET enabled=EXCLUDED.enabled,is_default=EXCLUDED.is_default,config=EXCLUDED.config,credentials=COALESCE(EXCLUDED.credentials,messaging_channels.credentials),webhook_secret=COALESCE(EXCLUDED.webhook_secret,messaging_channels.webhook_secret),sender_id=EXCLUDED.sender_id,notes=EXCLUDED.notes,updated_at=now()
    RETURNING id,name,channel_type,provider,enabled,is_default,config,sender_id,notes,updated_at`,
    [b.name,String(b.channel_type).toUpperCase(),String(b.provider).toUpperCase(),!!b.enabled,!!b.is_default,JSON.stringify(b.config||{}),encCreds?JSON.stringify(encCreds):null,encHook,b.sender_id||null,b.notes||null]);
  res.json({ data: r.rows[0] });
}));

router.put('/channels/:id', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req,res)) return;
  const b = req.body || {};
  const encCreds = b.credentials ? encryptCredentialsObject(b.credentials) : null;
  const encHook = encryptSecretValue(b.webhook_secret);
  const r = await pool.query(`UPDATE messaging_channels SET name=COALESCE($1,name), enabled=COALESCE($2,enabled), is_default=COALESCE($3,is_default), config=COALESCE($4::jsonb,config), credentials=COALESCE($5::jsonb,credentials), webhook_secret=COALESCE($6,webhook_secret), sender_id=COALESCE($7,sender_id), notes=$8, updated_at=now() WHERE id=$9 RETURNING id,name,channel_type,provider,enabled,is_default,config,sender_id,notes,updated_at`,
    [b.name,b.enabled,b.is_default,b.config?JSON.stringify(b.config):null,encCreds?JSON.stringify(encCreds):null,encHook,b.sender_id,b.notes||null,req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Channel not found' });
  res.json({ data: r.rows[0] });
}));

router.get('/templates', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
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

// ================= Full-featured Telegram =================
// Single Telegram transport (apps/api/src/integrations/telegram.ts).
// Webhook inbound is mounted PUBLICLY in main.ts (no JWT) and verified with
// Telegram's secret token; these management routes require messaging RBAC.

async function telegramChannel(channel_id?: string) {
  const ch = await getChannel(channel_id ? { channel_id } : { channel_type: 'TELEGRAM' });
  if (!ch) return null;
  const creds = decryptCredentialsObject(ch.credentials || {});
  const cfg = ch.config || {};
  const token = creds.bot_token || creds.token || process.env.TELEGRAM_BOT_TOKEN || undefined;
  const apiUrl: string | undefined = cfg.api_url || creds.api_url || undefined;
  return { ch, creds, cfg, token, apiUrl };
}

router.get('/telegram/get-me', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const t = await telegramChannel((req.query.channel_id as string) || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const r = await getTelegramMe(t.token, t.apiUrl);
  res.json({ ok: r.ok, ...(r.ok ? { data: r.result } : { message: r.error }) });
}));

router.get('/telegram/get-chat', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const t = await telegramChannel((req.query.channel_id as string) || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const chatId = String(req.query.chat_id || t.cfg.chat_id || t.creds.chat_id || '').trim();
  if (!chatId) return res.status(400).json({ ok: false, message: 'chat_id is required' });
  const r = await getTelegramChat(t.token, chatId, t.apiUrl);
  res.json({ ok: r.ok, ...(r.ok ? { data: r.result } : { message: r.error }) });
}));

router.get('/telegram/get-updates', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const t = await telegramChannel((req.query.channel_id as string) || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const r = await getTelegramUpdates(t.token, { offset: req.query.offset ? Number(req.query.offset) : undefined, limit: req.query.limit ? Number(req.query.limit) : 100 }, t.apiUrl);
  res.json({ ok: r.ok, ...(r.ok ? { data: r.result } : { message: r.error }) });
}));

router.get('/telegram/webhook-info', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const t = await telegramChannel((req.query.channel_id as string) || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const r = await getTelegramWebhookInfo(t.token, t.apiUrl);
  res.json({ ok: r.ok, ...(r.ok ? { data: r.result } : { message: r.error }) });
}));

router.post('/telegram/set-webhook', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const b = req.body || {};
  const t = await telegramChannel(b.channel_id || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const url = String(b.url || '').trim();
  if (!url) return res.status(400).json({ ok: false, message: 'url is required' });
  const secret = b.secret_token ? String(b.secret_token) : undefined;
  const r = await setTelegramWebhook(t.token, { url, secretToken: secret, allowedUpdates: b.allowed_updates, dropPendingUpdates: b.drop_pending_updates }, t.apiUrl);
  // Persist the secret (encrypted) so inbound webhook can verify it.
  if (r.ok) {
    await pool.query(`UPDATE messaging_channels SET webhook_secret=COALESCE($2, webhook_secret), updated_at=now() WHERE id=$1`, [t.ch.id, secret ? encryptSecretValue(secret) : null]);
  }
  res.json({ ok: r.ok, ...(r.ok ? { message: 'Webhook set' } : { message: r.error }) });
}));

router.post('/telegram/delete-webhook', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const b = req.body || {};
  const t = await telegramChannel(b.channel_id || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const r = await deleteTelegramWebhook(t.token, !!b.drop_pending_updates, t.apiUrl);
  res.json({ ok: r.ok, ...(r.ok ? { message: 'Webhook deleted' } : { message: r.error }) });
}));

router.post('/telegram/send-chat-action', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const b = req.body || {};
  const t = await telegramChannel(b.channel_id || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const chatId = String(b.chat_id || t.cfg.chat_id || t.creds.chat_id || '').trim();
  if (!chatId) return res.status(400).json({ ok: false, message: 'chat_id is required' });
  const r = await sendTelegramChatAction(t.token, chatId, String(b.action || 'typing'), t.apiUrl, b.message_thread_id);
  res.json({ ok: r.ok, ...(r.ok ? {} : { message: r.error }) });
}));

router.post('/telegram/send-photo', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const b = req.body || {};
  const t = await telegramChannel(b.channel_id || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const chatId = String(b.chat_id || t.cfg.chat_id || t.creds.chat_id || '').trim();
  if (!chatId || !b.photo) return res.status(400).json({ ok: false, message: 'chat_id and photo are required' });
  const r = await sendTelegramPhoto(t.token, { chatId, photo: String(b.photo), caption: b.caption, parseMode: b.parse_mode, disableNotification: !!b.disable_notification, protectContent: !!b.protect_content, messageThreadId: b.message_thread_id, replyMarkup: b.reply_markup }, t.apiUrl);
  res.json({ ok: r.ok, ...(r.ok ? { data: { message_id: r.message_id } } : { message: r.error }) });
}));

router.post('/telegram/send-document', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const b = req.body || {};
  const t = await telegramChannel(b.channel_id || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const chatId = String(b.chat_id || t.cfg.chat_id || t.creds.chat_id || '').trim();
  if (!chatId || !b.document) return res.status(400).json({ ok: false, message: 'chat_id and document are required' });
  const r = await sendTelegramDocument(t.token, { chatId, document: String(b.document), caption: b.caption, parseMode: b.parse_mode, disableNotification: !!b.disable_notification, protectContent: !!b.protect_content, messageThreadId: b.message_thread_id, replyMarkup: b.reply_markup }, t.apiUrl);
  res.json({ ok: r.ok, ...(r.ok ? { data: { message_id: r.message_id } } : { message: r.error }) });
}));

router.post('/telegram/send-location', asyncHandler(async (req, res) => {
  if (!requireMessagingRole(req, res)) return;
  const b = req.body || {};
  const t = await telegramChannel(b.channel_id || undefined);
  if (!t?.token) return res.status(400).json({ ok: false, message: 'Telegram bot token not configured' });
  const chatId = String(b.chat_id || t.cfg.chat_id || t.creds.chat_id || '').trim();
  if (!chatId || b.latitude == null || b.longitude == null) return res.status(400).json({ ok: false, message: 'chat_id, latitude, longitude are required' });
  const r = await sendTelegramLocation(t.token, { chatId, latitude: Number(b.latitude), longitude: Number(b.longitude), disableNotification: !!b.disable_notification, protectContent: !!b.protect_content, messageThreadId: b.message_thread_id }, t.apiUrl);
  res.json({ ok: r.ok, ...(r.ok ? { data: { message_id: r.message_id } } : { message: r.error }) });
}));

export default router;

