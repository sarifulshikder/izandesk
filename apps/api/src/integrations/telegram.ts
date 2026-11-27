/**
 * Full-featured Telegram Bot API integration (single transport).
 *
 * Used by the omnichannel messaging engine for provider `TELEGRAM_BOT` /
 * channel `TELEGRAM`, NOC alerts, and `/api/messaging/telegram/*` management.
 *
 * Honesty/safety invariants:
 *  - The bot token is NEVER returned in results, logs, audit, or error messages.
 *  - Failures are returned as `{ ok:false, ... }`; sending never throws.
 *  - Telegram `429 retry_after` and transient `5xx` are retried with backoff;
 *    the caller is responsible for idempotency.
 *  - Long text is chunked to Telegram's 4096-character limit (chunking can
 *    split HTML mid-tag; prefer short messages or `parse_mode:'NONE'`).
 */

export const TELEGRAM_MAX_TEXT_LEN = 4096;
export const TELEGRAM_MAX_CAPTION_LEN = 1024;
export const TELEGRAM_DEFAULT_API_URL = 'https://api.telegram.org';

export type TelegramParseMode = 'HTML' | 'Markdown' | 'MarkdownV2' | 'NONE' | '';

export interface TelegramInlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string };
}
export type TelegramReplyMarkup =
  | { inline_keyboard: TelegramInlineKeyboardButton[][] }
  | { keyboard: { text: string }[][]; resize_keyboard?: boolean; one_time_keyboard?: boolean }
  | { remove_keyboard: true }
  | { force_reply: true; input_field_placeholder?: string };

export interface TelegramResult {
  ok: boolean;
  status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'SIMULATED';
  error?: string;
  http_status?: number;
  error_code?: number;
  retry_after?: number;
  message_id?: number | null;
  chat_id?: string | number | null;
  raw?: any;
  chunks?: number;
}

export interface SendMessageOptions {
  chatId: string | number;
  text: string;
  parseMode?: TelegramParseMode;
  disablePreview?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  messageThreadId?: number | string;
  replyMarkup?: TelegramReplyMarkup;
}

export function escapeTelegramHtml(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Chunk text to `max` length, preferring newline/space boundaries. */
export function chunkTelegramText(text: string, max = TELEGRAM_MAX_TEXT_LEN): string[] {
  const s = String(text ?? '');
  if (s.length <= max) return [s];
  const chunks: string[] = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function normalizeParseMode(mode?: TelegramParseMode | string | null): TelegramParseMode {
  if (mode == null) return 'HTML';
  const m = String(mode).trim();
  if (m === '' ) return '';
  if (/^(none|off|plain|text)$/i.test(m)) return '';
  if (m.toLowerCase() === 'markdownv2') return 'MarkdownV2';
  if (m.toLowerCase() === 'markdown') return 'Markdown';
  if (m.toLowerCase() === 'html') return 'HTML';
  return m as TelegramParseMode;
}

function apiBase(apiUrl?: string): string {
  return String(apiUrl || TELEGRAM_DEFAULT_API_URL).replace(/\/+$/, '');
}

/** Redact a token from any string before it can leak into logs/errors. */
export function redactTelegramToken(text: string, token?: string): string {
  let s = String(text ?? '');
  if (token) s = s.split(token).join('***');
  return s.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***');
}

/** Deep-redact a raw Telegram payload so the token can't leak via `raw`. */
export function sanitizeTelegramRaw(data: any, token?: string): any {
  if (data == null) return null;
  try { return JSON.parse(redactTelegramToken(JSON.stringify(data), token)); } catch { return null; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call a Bot API method. Never throws; never leaks token.
 * Retries `429` (honoring `retry_after`) and `5xx` up to `maxRetries`.
 */
export async function tgRequest(opts: {
  token: string;
  method: string;
  body?: Record<string, any>;
  apiUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<{ ok: boolean; status: number; data: any; error?: string; retry_after?: number }> {
  const token = String(opts.token || '');
  const base = apiBase(opts.apiUrl);
  const url = `${base}/bot${token}/${opts.method}`;
  const maxRetries = Math.max(0, opts.maxRetries ?? 2);
  const timeoutMs = opts.timeoutMs ?? 10000;

  let lastErr = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.body || {}),
        signal: ctrl.signal,
      } as any);
      clearTimeout(t);
      const text = await res.text();
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      const ok = res.ok && (!data || data.ok !== false);
      if (ok) return { ok: true, status: res.status, data: sanitizeTelegramRaw(data, token) };

      const retryAfter = Number(data?.parameters?.retry_after) || Number(data?.retry_after) || 0;
      lastErr = redactTelegramToken(data?.description || data?.error || `HTTP ${res.status}`, token);
      // Retry rate-limit (429) honoring retry_after, and transient server errors (5xx).
      if (attempt < maxRetries && (res.status === 429 || res.status >= 500)) {
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 300 * (attempt + 1));
        continue;
      }
      return { ok: false, status: res.status, data: sanitizeTelegramRaw(data, token), error: lastErr, retry_after: retryAfter || undefined };
    } catch (err: any) {
      clearTimeout(t);
      lastErr = redactTelegramToken(err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (err?.message || String(err)), token);
      if (attempt < maxRetries) { await sleep(300 * (attempt + 1)); continue; }
      return { ok: false, status: 0, data: null, error: lastErr };
    }
  }
  return { ok: false, status: 0, data: null, error: lastErr || 'unknown error' };
}

function applyCommon(body: Record<string, any>, o: { disableNotification?: boolean; protectContent?: boolean; messageThreadId?: number | string; replyMarkup?: TelegramReplyMarkup }) {
  if (o.disableNotification) body.disable_notification = true;
  if (o.protectContent) body.protect_content = true;
  if (o.messageThreadId != null && o.messageThreadId !== '') body.message_thread_id = Number(o.messageThreadId) || o.messageThreadId;
  if (o.replyMarkup) body.reply_markup = o.replyMarkup;
  return body;
}

/** Send a text message, chunking to 4096. `ok` is true only if all chunks sent. */
export async function sendTelegramMessage(token: string, o: SendMessageOptions, apiUrl?: string): Promise<TelegramResult> {
  if (!token) return { ok: false, status: 'NOT_CONFIGURED', error: 'bot token missing' };
  if (o.chatId == null || String(o.chatId).trim() === '') return { ok: false, status: 'NOT_CONFIGURED', error: 'chat id missing' };
  const mode = normalizeParseMode(o.parseMode);
  const chunks = chunkTelegramText(o.text, TELEGRAM_MAX_TEXT_LEN);
  const ids: number[] = [];
  let firstRaw: any = null;
  let lastChunkRaw: any = null;

  for (let i = 0; i < chunks.length; i++) {
    const body: Record<string, any> = { chat_id: String(o.chatId), text: chunks[i] };
    if (mode) body.parse_mode = mode;
    body.disable_web_page_preview = !!o.disablePreview;
    applyCommon(body, { disableNotification: o.disableNotification, protectContent: o.protectContent, messageThreadId: o.messageThreadId, replyMarkup: i === 0 ? o.replyMarkup : undefined });
    const res = await tgRequest({ token, method: 'sendMessage', body, apiUrl });
    if (!res.ok) return { ok: false, status: 'FAILED', error: res.error, http_status: res.status, error_code: res.data?.error_code, retry_after: res.retry_after, raw: res.data, chunks: chunks.length };
    if (i === 0) firstRaw = res.data;
    lastChunkRaw = res.data;
    if (res.data?.result?.message_id != null) ids.push(res.data.result.message_id);
  }
  return { ok: true, status: 'SENT', chat_id: o.chatId, message_id: ids[0] ?? null, raw: lastChunkRaw || firstRaw, chunks: chunks.length };
}

async function sendMedia(token: string, method: 'sendPhoto' | 'sendDocument' | 'sendVoice' | 'sendVideo', key: 'photo' | 'document' | 'voice' | 'video', media: string, o: { chatId: string | number; caption?: string; parseMode?: TelegramParseMode; disableNotification?: boolean; protectContent?: boolean; messageThreadId?: number | string; replyMarkup?: TelegramReplyMarkup }, apiUrl?: string): Promise<TelegramResult> {
  if (!token) return { ok: false, status: 'NOT_CONFIGURED', error: 'bot token missing' };
  if (o.chatId == null || String(o.chatId).trim() === '') return { ok: false, status: 'NOT_CONFIGURED', error: 'chat id missing' };
  const body: Record<string, any> = { chat_id: String(o.chatId), [key]: media };
  if (o.caption) body.caption = String(o.caption).slice(0, TELEGRAM_MAX_CAPTION_LEN);
  const mode = normalizeParseMode(o.parseMode); if (mode) body.parse_mode = mode;
  applyCommon(body, { disableNotification: o.disableNotification, protectContent: o.protectContent, messageThreadId: o.messageThreadId, replyMarkup: o.replyMarkup });
  const res = await tgRequest({ token, method, body, apiUrl });
  if (!res.ok) return { ok: false, status: 'FAILED', error: res.error, http_status: res.status, raw: res.data };
  return { ok: true, status: 'SENT', chat_id: o.chatId, message_id: res.data?.result?.message_id ?? null, raw: res.data };
}

export function sendTelegramPhoto(token: string, o: { chatId: string | number; photo: string; caption?: string; parseMode?: TelegramParseMode; disableNotification?: boolean; protectContent?: boolean; messageThreadId?: number | string; replyMarkup?: TelegramReplyMarkup }, apiUrl?: string) { return sendMedia(token, 'sendPhoto', 'photo', o.photo, o, apiUrl); }
export function sendTelegramDocument(token: string, o: { chatId: string | number; document: string; caption?: string; parseMode?: TelegramParseMode; disableNotification?: boolean; protectContent?: boolean; messageThreadId?: number | string; replyMarkup?: TelegramReplyMarkup }, apiUrl?: string) { return sendMedia(token, 'sendDocument', 'document', o.document, o, apiUrl); }
export function sendTelegramVoice(token: string, o: { chatId: string | number; voice: string; caption?: string; disableNotification?: boolean; protectContent?: boolean; messageThreadId?: number | string }, apiUrl?: string) { return sendMedia(token, 'sendVoice', 'voice', o.voice, o, apiUrl); }
export function sendTelegramVideo(token: string, o: { chatId: string | number; video: string; caption?: string; parseMode?: TelegramParseMode; disableNotification?: boolean; protectContent?: boolean; messageThreadId?: number | string; replyMarkup?: TelegramReplyMarkup }, apiUrl?: string) { return sendMedia(token, 'sendVideo', 'video', o.video, o, apiUrl); }

export async function sendTelegramLocation(token: string, o: { chatId: string | number; latitude: number; longitude: number; disableNotification?: boolean; protectContent?: boolean; messageThreadId?: number | string }, apiUrl?: string): Promise<TelegramResult> {
  if (!token) return { ok: false, status: 'NOT_CONFIGURED', error: 'bot token missing' };
  const body: Record<string, any> = { chat_id: String(o.chatId), latitude: o.latitude, longitude: o.longitude };
  applyCommon(body, { disableNotification: o.disableNotification, protectContent: o.protectContent, messageThreadId: o.messageThreadId });
  const res = await tgRequest({ token, method: 'sendLocation', body, apiUrl });
  if (!res.ok) return { ok: false, status: 'FAILED', error: res.error, http_status: res.status, raw: res.data };
  return { ok: true, status: 'SENT', chat_id: o.chatId, message_id: res.data?.result?.message_id ?? null, raw: res.data };
}

export async function sendTelegramChatAction(token: string, chatId: string | number, action: string, apiUrl?: string, messageThreadId?: number | string): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, any> = { chat_id: String(chatId), action };
  if (messageThreadId != null) body.message_thread_id = messageThreadId;
  const res = await tgRequest({ token, method: 'sendChatAction', body, apiUrl, maxRetries: 0 });
  return { ok: res.ok, error: res.error };
}

export async function getTelegramMe(token: string, apiUrl?: string): Promise<{ ok: boolean; result?: any; error?: string }> {
  const res = await tgRequest({ token, method: 'getMe', body: {}, apiUrl, maxRetries: 0 });
  return { ok: res.ok, result: res.data?.result, error: res.error };
}

export async function getTelegramChat(token: string, chatId: string | number, apiUrl?: string): Promise<{ ok: boolean; result?: any; error?: string }> {
  const res = await tgRequest({ token, method: 'getChat', body: { chat_id: String(chatId) }, apiUrl, maxRetries: 0 });
  return { ok: res.ok, result: res.data?.result, error: res.error };
}

export async function getTelegramUpdates(token: string, opts: { offset?: number; limit?: number; timeout?: number } = {}, apiUrl?: string): Promise<{ ok: boolean; result?: any[]; error?: string }> {
  const body: Record<string, any> = { limit: opts.limit ?? 100, timeout: opts.timeout ?? 0 };
  if (opts.offset != null) body.offset = opts.offset;
  const res = await tgRequest({ token, method: 'getUpdates', body, apiUrl, maxRetries: 0, timeoutMs: 15000 });
  return { ok: res.ok, result: res.data?.result || [], error: res.error };
}

export async function setTelegramWebhook(token: string, o: { url: string; secretToken?: string; allowedUpdates?: string[]; maxConnections?: number; dropPendingUpdates?: boolean }, apiUrl?: string): Promise<{ ok: boolean; error?: string; raw?: any }> {
  const body: Record<string, any> = { url: o.url };
  if (o.secretToken) body.secret_token = o.secretToken;
  if (o.allowedUpdates) body.allowed_updates = o.allowedUpdates;
  if (o.maxConnections != null) body.max_connections = o.maxConnections;
  if (o.dropPendingUpdates != null) body.drop_pending_updates = o.dropPendingUpdates;
  const res = await tgRequest({ token, method: 'setWebhook', body, apiUrl, maxRetries: 0 });
  return { ok: res.ok, error: res.error, raw: res.data };
}

export async function deleteTelegramWebhook(token: string, dropPendingUpdates = false, apiUrl?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await tgRequest({ token, method: 'deleteWebhook', body: { drop_pending_updates: dropPendingUpdates }, apiUrl, maxRetries: 0 });
  return { ok: res.ok, error: res.error };
}

export async function getTelegramWebhookInfo(token: string, apiUrl?: string): Promise<{ ok: boolean; result?: any; error?: string }> {
  const res = await tgRequest({ token, method: 'getWebhookInfo', body: {}, apiUrl, maxRetries: 0 });
  return { ok: res.ok, result: res.data?.result, error: res.error };
}
