import { pool } from '../db';

function renderTemplate(body: string, vars: Record<string, any> = {}) {
  return String(body || '').replace(/\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}/g, (_m, k) => {
    const parts = String(k).split('.');
    let v: any = vars;
    for (const p of parts) v = v?.[p];
    return v == null ? '' : String(v);
  });
}

async function postJson(url: string, payload: any, headers: Record<string,string> = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload), signal: ctrl.signal } as any);
    const text = await r.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } finally { clearTimeout(t); }
}

async function postForm(url: string, form: Record<string, any>, headers: Record<string,string> = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const params = new URLSearchParams();
    Object.entries(form || {}).forEach(([k,v]) => { if (v != null) params.append(k, String(v)); });
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: params.toString(), signal: ctrl.signal } as any);
    const text = await r.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } finally { clearTimeout(t); }
}

export async function sendViaProvider(channel: any, payload: { to?: string|null; subject?: string|null; body: string; meta?: any }) {
  const provider = String(channel?.provider || '').toUpperCase();
  const type = String(channel?.channel_type || '').toUpperCase();
  const creds = channel?.credentials || {};
  const cfg = channel?.config || {};
  const nowId = `${provider}-${Date.now()}-${Math.floor(Math.random()*10000)}`;
  const to = payload.to || cfg.chat_id || creds.chat_id || null;

  try {
    if (provider === 'GREENWEB') {
      const token = creds.token || creds.api_key;
      if (token) {
        // Common BD SMS API patterns supported best-effort
        const url = cfg.api_url || creds.api_url || 'https://api.greenweb.com.bd/api.php';
        const res = cfg.json ? await postJson(url, { token, to, message: payload.body, ...(cfg.params||{}) }) : await postForm(url, { token, to, message: payload.body, ...(cfg.params||{}) });
        return { ok: res.ok, status: res.ok ? 'SENT' : 'FAILED', provider_message_id: res.data?.message_id || res.data?.id || nowId, mode: 'live', response: res.data, note: res.ok ? 'Dispatched via GreenWeb' : 'GreenWeb dispatch failed' };
      }
      return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'GreenWeb not configured with live credentials; simulated.' };
    }
    if (provider === 'TWILIO') {
      const sid = creds.account_sid;
      const token = creds.auth_token || creds.api_key;
      const from = channel?.sender_id || cfg.from || creds.from;
      if (sid && token && from && to) {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
        const auth = Buffer.from(`${sid}:${token}`).toString('base64');
        const ctrl = new AbortController();
        const t = setTimeout(()=>ctrl.abort(), 8000);
        try {
          const params = new URLSearchParams({ To: String(to), From: String(from), Body: String(payload.body) });
          const r = await fetch(url, { method:'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: ctrl.signal } as any);
          const data = await r.json().catch(()=>null);
          return { ok: r.ok, status: r.ok ? 'SENT' : 'FAILED', provider_message_id: data?.sid || nowId, mode: 'live', response: data, note: r.ok ? 'Dispatched via Twilio' : 'Twilio dispatch failed' };
        } finally { clearTimeout(t); }
      }
      return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'Twilio not fully configured (sid/token/from/to); simulated.' };
    }
    if (provider === 'META_CLOUD' || type === 'WHATSAPP') {
      const token = creds.access_token || creds.token;
      const phoneId = creds.phone_number_id || cfg.phone_number_id;
      if (token && phoneId && to) {
        const url = cfg.api_url || `https://graph.facebook.com/v19.0/${encodeURIComponent(String(phoneId))}/messages`;
        const body: any = payload.meta?.template
          ? { messaging_product: 'whatsapp', to, type: 'template', template: payload.meta.template }
          : { messaging_product: 'whatsapp', to, type: 'text', text: { body: payload.body, preview_url: true } };
        const res = await postJson(url, body, { Authorization: `Bearer ${token}` });
        return { ok: res.ok, status: res.ok ? 'SENT' : 'FAILED', provider_message_id: res.data?.messages?.[0]?.id || nowId, mode: 'live', response: res.data, note: res.ok ? 'Dispatched via WhatsApp Cloud API' : 'WhatsApp dispatch failed' };
      }
      return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'WhatsApp Cloud not configured (token/phone_number_id/to); simulated.' };
    }
    if (provider === 'TELEGRAM_BOT' || type === 'TELEGRAM') {
      const token = creds.bot_token || creds.token;
      const chatId = to || cfg.chat_id || creds.chat_id;
      if (token && chatId) {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await postJson(url, { chat_id: chatId, text: payload.body, parse_mode: cfg.parse_mode || 'HTML', disable_web_page_preview: !!cfg.disable_preview });
        return { ok: res.ok && res.data?.ok !== false, status: (res.ok && res.data?.ok !== false) ? 'SENT' : 'FAILED', provider_message_id: String(res.data?.result?.message_id || nowId), mode: 'live', response: res.data, note: (res.ok && res.data?.ok !== false) ? 'Dispatched via Telegram Bot API' : 'Telegram dispatch failed' };
      }
      return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'Telegram bot not configured (token/chat_id); simulated.' };
    }
    return { ok: true, status: 'SIMULATED', provider_message_id: nowId, mode: 'simulated', note: 'Provider dispatch simulated.' };
  } catch (e: any) {
    return { ok: false, status: 'FAILED', provider_message_id: nowId, mode: 'error', error: e?.message || String(e), note: 'Dispatch exception' };
  }
}

export async function logMessage(row: any) {
  const r = await pool.query(`INSERT INTO message_logs(channel_type,provider,channel_id,direction,recipient,subject,body,status,provider_message_id,related_type,related_id,payload,error_message,sent_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) RETURNING *`,
    [row.channel_type,row.provider,row.channel_id||null,row.direction||'OUTBOUND',row.recipient||null,row.subject||null,row.body||null,row.status||'QUEUED',row.provider_message_id||null,row.related_type||null,row.related_id||null,JSON.stringify(row.payload||{}),row.error_message||null,row.sent_at||null]);
  return r.rows[0];
}

export async function getChannel(opts: { channel_id?: string; channel_type?: string; provider?: string }) {
  if (opts.channel_id) return (await pool.query('SELECT * FROM messaging_channels WHERE id=$1', [opts.channel_id])).rows[0] || null;
  if (opts.channel_type && opts.provider) return (await pool.query('SELECT * FROM messaging_channels WHERE channel_type=$1 AND provider=$2 ORDER BY enabled DESC, is_default DESC, updated_at DESC LIMIT 1', [String(opts.channel_type).toUpperCase(), String(opts.provider).toUpperCase()])).rows[0] || null;
  if (opts.channel_type) return (await pool.query('SELECT * FROM messaging_channels WHERE channel_type=$1 ORDER BY enabled DESC, is_default DESC, updated_at DESC LIMIT 1', [String(opts.channel_type).toUpperCase()])).rows[0] || null;
  if (opts.provider) return (await pool.query('SELECT * FROM messaging_channels WHERE provider=$1 ORDER BY enabled DESC, is_default DESC, updated_at DESC LIMIT 1', [String(opts.provider).toUpperCase()])).rows[0] || null;
  return null;
}

export async function dispatchMessage(opts: { channel_id?: string; channel_type?: string; provider?: string; to?: string|null; subject?: string|null; body?: string; template_id?: string; template_name?: string; variables?: Record<string,any>; related_type?: string; related_id?: string; meta?: any; requireEnabled?: boolean }) {
  const channel = await getChannel(opts);
  if (!channel) throw new Error('Messaging channel not found');
  if (opts.requireEnabled && !channel.enabled) throw new Error('Messaging channel is disabled');
  let body = opts.body || '';
  let subject = opts.subject || null;
  if (opts.template_id) {
    const t = (await pool.query('SELECT * FROM message_templates WHERE id=$1', [opts.template_id])).rows[0];
    if (t) { body = renderTemplate(t.body, opts.variables || {}); subject = subject || (t.subject ? renderTemplate(t.subject, opts.variables || {}) : null); }
  } else if (opts.template_name) {
    const t = (await pool.query('SELECT * FROM message_templates WHERE name=$1 AND ($2::text IS NULL OR channel_type=$2)', [opts.template_name, opts.channel_type ? String(opts.channel_type).toUpperCase() : channel.channel_type])).rows[0]
      || (await pool.query('SELECT * FROM message_templates WHERE name=$1 LIMIT 1', [opts.template_name])).rows[0];
    if (t) { body = renderTemplate(t.body, opts.variables || {}); subject = subject || (t.subject ? renderTemplate(t.subject, opts.variables || {}) : null); }
  } else if (body) {
    body = renderTemplate(body, opts.variables || {});
  }
  if (!body) throw new Error('Message body or template is required');
  const to = opts.to || channel?.config?.chat_id || channel?.credentials?.chat_id || null;
  if (!to && String(channel.channel_type).toUpperCase() !== 'TELEGRAM') throw new Error('Recipient (to/chat_id) is required');
  const result = await sendViaProvider(channel, { to, subject, body, meta: opts.meta || {} });
  const log = await logMessage({
    channel_type: channel.channel_type,
    provider: channel.provider,
    channel_id: channel.id,
    direction: 'OUTBOUND',
    recipient: to,
    subject,
    body,
    status: result.status || (result.ok ? 'SENT' : 'FAILED'),
    provider_message_id: result.provider_message_id || null,
    related_type: opts.related_type || null,
    related_id: opts.related_id || null,
    payload: { variables: opts.variables || {}, meta: opts.meta || {}, result },
    error_message: result.ok ? null : (result.error || result.note || 'Failed'),
    sent_at: result.ok && (result.status === 'SENT' || result.status === 'SIMULATED') ? new Date() : null,
  });
  return { ok: !!result.ok || result.status === 'SIMULATED', result, log, channel };
}

export async function trySendTemplateToSubscriber(subscriberId: string, templateName: string, extraVars: Record<string,any> = {}, channelPref?: { channel_type?: string; provider?: string }) {
  try {
    const s = (await pool.query(`SELECT s.*, r.name as reseller_name, i.invoice_number, i.total_amount::float as invoice_total, i.due_amount::float as invoice_due
      FROM subscribers s LEFT JOIN resellers r ON r.id=s.reseller_id
      LEFT JOIN LATERAL (SELECT invoice_number,total_amount,due_amount FROM invoices WHERE subscriber_id=s.id ORDER BY issue_date DESC LIMIT 1) i ON true
      WHERE s.id=$1`, [subscriberId])).rows[0];
    if (!s) return null;
    const to = s.phone || s.whatsapp || s.email || null;
    // Seeded templates use {{invoice_no}}/{{brand}}/{{amount}}. Callers have
    // historically passed invoice_number instead, which rendered blank values.
    const vars = {
      ...s,
      ...extraVars,
      brand: extraVars.brand ?? 'IzanDesk',
      name: s.full_name,
      invoice_no: extraVars.invoice_no ?? extraVars.invoice_number ?? s.invoice_number,
      due: extraVars.due ?? s.current_due,
      amount: extraVars.amount ?? s.monthly_bill,
      due_date: extraVars.due_date,
      pdf_url: extraVars.pdf_url || '',
    };
    return await dispatchMessage({ template_name: templateName, channel_type: channelPref?.channel_type, provider: channelPref?.provider, to, variables: vars, related_type: 'SUBSCRIBER', related_id: subscriberId, requireEnabled: false });
  } catch { return null; }
}

export async function runMessagingSchedulerSweep() {
  // Send daily revenue summary to enabled Telegram/NOC channels if not sent today (best-effort)
  try {
    const channels = (await pool.query(`SELECT * FROM messaging_channels WHERE enabled=true AND (provider='TELEGRAM_BOT' OR channel_type='TELEGRAM')`)).rows;
    if (channels.length) {
      const today = new Date().toISOString().slice(0,10);
      const metrics = (await pool.query(`SELECT COALESCE(SUM(amount),0)::float as revenue_today, COUNT(*)::int as payments_today FROM payments WHERE status='COMPLETED' AND created_at::date = CURRENT_DATE`)).rows[0] || { revenue_today: 0, payments_today: 0 };
      const due = (await pool.query(`SELECT COALESCE(SUM(due_amount),0)::float as due, COUNT(*)::int as due_invoices FROM invoices WHERE status IN ('UNPAID','PARTIAL','OVERDUE')`)).rows[0] || { due: 0, due_invoices: 0 };
      // The seeded Telegram template expects collections/invoices/outstanding.
      const vars = {
        date: today,
        collections: metrics.revenue_today,
        invoices: metrics.payments_today,
        outstanding: due.due,
        revenue_today: metrics.revenue_today,
        payments_today: metrics.payments_today,
        due_total: due.due,
        due_invoices: due.due_invoices,
      };
      for (const ch of channels) {
        // Failed sends must be retried; only a delivered/simulated send counts.
        const sent = (await pool.query(`SELECT 1 FROM message_logs WHERE channel_id=$1 AND related_type='DAILY_REVENUE_SUMMARY' AND status IN ('SENT','SIMULATED') AND created_at::date=CURRENT_DATE LIMIT 1`, [ch.id])).rows[0];
        if (sent) continue;
        await dispatchMessage({ channel_id: ch.id, template_name: 'daily_revenue_summary_telegram', variables: vars, related_type: 'DAILY_REVENUE_SUMMARY', to: ch.config?.chat_id || ch.credentials?.chat_id || null, requireEnabled: false }).catch(()=>{});
      }
    }
  } catch {}

  // Due reminders: notify subscribers with invoices due within warning window (once per invoice/channel type per day, best-effort)
  try {
    const policy = (await pool.query('SELECT * FROM billing_policies ORDER BY is_default DESC, created_at ASC LIMIT 1')).rows[0];
    const warnDays = Number(policy?.warning_days ?? 3);
    const rows = (await pool.query(`
      SELECT i.id as invoice_id, i.invoice_number, i.due_amount::float as due_amount, i.due_date, s.id as subscriber_id, s.full_name, s.phone
      FROM invoices i JOIN subscribers s ON s.id=i.subscriber_id
      WHERE i.status IN ('UNPAID','PARTIAL','OVERDUE') AND i.due_amount > 0 AND s.phone IS NOT NULL AND s.phone <> ''
        AND i.due_date <= (CURRENT_DATE + ($1::int * INTERVAL '1 day'))
      ORDER BY i.due_date ASC LIMIT 100`, [warnDays])).rows;
    for (const r of rows) {
      const sent = (await pool.query(`SELECT 1 FROM message_logs WHERE related_type='INVOICE_DUE_REMINDER' AND related_id=$1 AND status IN ('SENT','SIMULATED') AND created_at::date=CURRENT_DATE LIMIT 1`, [String(r.invoice_id)])).rows[0];
      if (sent) continue;
      await dispatchMessage({ channel_type: 'SMS', template_name: 'invoice_due_reminder_sms', to: r.phone, variables: { name: r.full_name, invoice_no: r.invoice_number, invoice_number: r.invoice_number, amount: r.due_amount, due: r.due_amount, due_date: r.due_date, brand: 'IzanDesk' }, related_type: 'INVOICE_DUE_REMINDER', related_id: String(r.invoice_id), requireEnabled: false }).catch(()=>{});
    }
  } catch {}
}
