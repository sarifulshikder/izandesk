'use strict';
/* Full-featured Telegram integration tests (no real bot token / network; stubbed fetch).
 * Run: node tests/telegram.test.cjs (requires: pnpm --filter api build first) */
const assert = require('assert');
const tg = require('../dist/integrations/telegram.js');

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

const realFetch = global.fetch;

async function withFetch(impl, fn) {
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : {} }); return impl(url, opts, calls.length - 1); };
  try { return await fn(calls); } finally { global.fetch = realFetch; }
}

(async () => {
  // escaping
  check('escapeTelegramHtml', tg.escapeTelegramHtml('<a>&"x"') === '&lt;a&gt;&amp;&quot;x&quot;');
  check('escapeTelegramHtml null', tg.escapeTelegramHtml(null) === '');

  // chunking
  const chunks = tg.chunkTelegramText('x'.repeat(9000), 4096);
  check('chunk len', chunks.length === 3 && chunks.every((c) => c.length <= 4096));
  check('chunk no-op', tg.chunkTelegramText('hi').length === 1 && tg.chunkTelegramText('hi')[0] === 'hi');
  const lines = tg.chunkTelegramText('a\n'.repeat(5000), 4096);
  check('chunk splits', lines.every((c) => c.length <= 4096));

  // token redaction
  check('redact bot token', tg.redactTelegramToken('err bot123456:ABC_def-123 here', '123456:ABC_def-123') === 'err bot*** here');

  // sendTelegramMessage basic + full options
  await withFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { message_id: 7 } }) }), async (calls) => {
    const r = await tg.sendTelegramMessage('TOKEN', { chatId: '42', text: '<b>hi</b>', parseMode: 'HTML', disablePreview: true, disableNotification: true, protectContent: true, messageThreadId: 5, replyMarkup: { inline_keyboard: [[{ text: 'Open', url: 'https://x' }]] } });
    check('send ok', r.ok && r.status === 'SENT' && r.message_id === 7);
    const b = calls[0].body;
    check('url', calls[0].url === 'https://api.telegram.org/botTOKEN/sendMessage');
    check('chat_id', b.chat_id === '42');
    check('parse_mode', b.parse_mode === 'HTML');
    check('preview', b.disable_web_page_preview === true);
    check('silent', b.disable_notification === true);
    check('protect', b.protect_content === true);
    check('thread', b.message_thread_id === 5);
    check('keyboard', !!b.reply_markup && b.reply_markup.inline_keyboard[0][0].url === 'https://x');
    check('no token in body', !JSON.stringify(b).includes('TOKEN'));
    check('no token in result', !JSON.stringify(r).includes('TOKEN'));
  });

  // parse_mode NONE omits parse_mode; markdownv2 normalized
  await withFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: {} }) }), async (calls) => {
    await tg.sendTelegramMessage('T', { chatId: 1, text: 'x', parseMode: 'NONE' });
    check('NONE omits parse_mode', !('parse_mode' in calls[0].body));
    await tg.sendTelegramMessage('T', { chatId: 1, text: 'x', parseMode: 'MarkdownV2' });
    check('MarkdownV2', calls[1].body.parse_mode === 'MarkdownV2');
  });

  // chunking sends multiple messages; reply_markup only on first chunk
  await withFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { message_id: 1 } }) }), async (calls) => {
    const r = await tg.sendTelegramMessage('T', { chatId: 1, text: 'x'.repeat(9000), replyMarkup: { force_reply: true } });
    check('chunked count', r.chunks === 3 && calls.length === 3);
    check('reply markup first chunk only', !!calls[0].body.reply_markup && !calls[1].body.reply_markup);
  });

  // NOT_CONFIGURED
  let r = await tg.sendTelegramMessage('', { chatId: 1, text: 'x' });
  check('no token NOT_CONFIGURED', !r.ok && r.status === 'NOT_CONFIGURED');
  r = await tg.sendTelegramMessage('T', { chatId: '', text: 'x' });
  check('no chat NOT_CONFIGURED', !r.ok && r.status === 'NOT_CONFIGURED');

  // 429 retry honoring retry_after then success
  await withFetch(async (_u, _o, i) => i === 0
    ? { ok: false, status: 429, text: async () => JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } }) }
    : { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { message_id: 9 } }) }, async (calls) => {
    const res = await tg.sendTelegramMessage('T', { chatId: 1, text: 'x' });
    check('429 retried', res.ok && calls.length === 2);
  });

  // 5xx retry
  await withFetch(async (_u, _o, i) => i === 0
    ? { ok: false, status: 500, text: async () => 'server error' }
    : { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: {} }) }, async (calls) => {
    const res = await tg.sendTelegramMessage('T', { chatId: 1, text: 'x' });
    check('5xx retried', res.ok && calls.length === 2);
  });

  // hard failure (401) no retry + no token leak in error
  await withFetch(async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ ok: false, description: 'Unauthorized bot123456:SECRET_TOKEN' }) }), async (calls) => {
    const res = await tg.sendTelegramMessage('123456:SECRET_TOKEN', { chatId: 1, text: 'x' });
    check('401 no retry', !res.ok && calls.length === 1);
    check('401 no token leak', !JSON.stringify(res).includes('SECRET_TOKEN'));
  });

  // media
  await withFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { message_id: 3 } }) }), async (calls) => {
    const p = await tg.sendTelegramPhoto('T', { chatId: 1, photo: 'https://x/y.png', caption: 'cap', parseMode: 'HTML' });
    check('sendPhoto', p.ok && calls[0].url.endsWith('/sendPhoto') && calls[0].body.photo === 'https://x/y.png' && calls[0].body.caption === 'cap');
    const d = await tg.sendTelegramDocument('T', { chatId: 1, document: 'https://x/f.pdf' });
    check('sendDocument', d.ok && calls[1].url.endsWith('/sendDocument') && calls[1].body.document === 'https://x/f.pdf');
    const l = await tg.sendTelegramLocation('T', { chatId: 1, latitude: 23.8, longitude: 90.4 });
    check('sendLocation', l.ok && calls[2].url.endsWith('/sendLocation') && calls[2].body.latitude === 23.8 && calls[2].body.longitude === 90.4);
  });

  // chat action / getMe / getChat / getUpdates / webhook methods
  await withFetch(async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: url.endsWith('/getMe') ? { id: 1, username: 'bot' } : url.endsWith('/getUpdates') ? [] : true }) }), async (calls) => {
    check('sendChatAction', (await tg.sendTelegramChatAction('T', 1, 'typing')).ok);
    check('getMe', (await tg.getTelegramMe('T')).result?.username === 'bot');
    check('getChat', (await tg.getTelegramChat('T', 1)).ok);
    check('getUpdates', (await tg.getTelegramUpdates('T', { limit: 5 })).ok && calls.some((c) => c.url.endsWith('/getUpdates')));
    check('setWebhook', (await tg.setTelegramWebhook('T', { url: 'https://x/hook', secretToken: 's' })).ok);
    check('deleteWebhook', (await tg.deleteTelegramWebhook('T')).ok);
    check('getWebhookInfo', (await tg.getTelegramWebhookInfo('T')).ok);
    const sw = calls.find((c) => c.url.endsWith('/setWebhook'));
    check('setWebhook body', sw && sw.body.url === 'https://x/hook' && sw.body.secret_token === 's');
  });

  // messaging engine routes Telegram through the full-featured transport
  const messaging = require('../dist/integrations/messaging.js');
  const db = require('../dist/db/index.js');
  const origQuery = db.pool.query; db.pool.query = async () => ({ rows: [] });
  const channel = { channel_type: 'TELEGRAM', provider: 'TELEGRAM_BOT', config: { chat_id: '99', parse_mode: 'HTML' }, credentials: {} };
  // credentials are decrypted; inject plaintext bot_token via decrypted path by monkey-patching secret-store is complex;
  // instead verify SIMULATED when no token (proves no throw + contract).
  const sim = await messaging.sendViaProvider(channel, { body: 'hi', to: null, meta: {} });
  check('no token -> SIMULATED', sim.ok && sim.status === 'SIMULATED' && sim.mode === 'simulated');
  db.pool.query = origQuery;

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
