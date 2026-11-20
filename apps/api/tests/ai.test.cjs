'use strict';
/* Unit tests for the AI Copilot server logic: local-engine intent detection,
 * external-LLM action validation, action renders, askAI smoke.
 * Run: node tests/ai.test.cjs  (requires: pnpm --filter api build first) */
const ai = require('../dist/integrations/ai.js');

const fakePool = { query: async () => ({ rows: [] }) };
const admin = { role: 'SUPER_ADMIN', actor: { id: 'u1', name: 'Admin', role: 'SUPER_ADMIN' } };
const reseller = { role: 'RESELLER', actor: { id: 'u2', name: 'Reseller', role: 'RESELLER' } };
const ids = new Set(['rasel', 'id-45', '20455030110', 'cybernet', 'rashed rahman', 'TKT-000123']);

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
}
const actionOf = (intent, ctx, message, set) => {
  const r = ai.externalActionFromLLM(JSON.stringify(intent), ctx, message, set || ids);
  return r && r.action;
};

/* ---------------- externalActionFromLLM ---------------- */
check('suspend rasel → set_subscriber_status', actionOf({ type: 'action', intent: 'set_subscriber_status', identifier: 'rasel', status: 'SUSPENDED' }, admin, 'suspend rasel')?.payload.status === 'SUSPENDED');
check('activate rasel → ACTIVE', actionOf({ type: 'action', intent: 'set_subscriber_status', identifier: 'rasel', status: 'ACTIVATE' }, admin, 'activate rasel')?.payload.status === 'ACTIVE');
check('RESELLER cannot suspend', actionOf({ type: 'action', intent: 'set_subscriber_status', identifier: 'rasel', status: 'SUSPENDED' }, reseller, 'suspend rasel') === undefined);
check('invented identifier rejected', actionOf({ type: 'action', intent: 'set_subscriber_status', identifier: 'notarealsearch', status: 'SUSPENDED' }, admin, 'suspend notarealsearch') === undefined);
check('garbage status rejected', actionOf({ type: 'action', intent: 'set_subscriber_status', identifier: 'rasel', status: 'WEIRD' }, admin, 'do something to rasel') === undefined);
check('question message → no action', actionOf({ type: 'action', intent: 'set_subscriber_status', identifier: 'rasel', status: 'SUSPENDED' }, admin, 'is rasel active?') === undefined);
check('topup 500 ok', actionOf({ type: 'action', intent: 'topup_reseller_wallet', identifier: 'cybernet', amount: 500 }, admin, 'top up wallet of cybernet with 500')?.payload.amount === 500);
check('topup >100000 rejected', actionOf({ type: 'action', intent: 'topup_reseller_wallet', identifier: 'cybernet', amount: 200000 }, admin, 'top up cybernet 200000') === undefined);
check('topup negative rejected', actionOf({ type: 'action', intent: 'topup_reseller_wallet', identifier: 'cybernet', amount: -5 }, admin, 'top up cybernet -5') === undefined);
check('create_ticket action', actionOf({ type: 'action', intent: 'create_ticket', subject: 'late payment', priority: 'high' }, admin, 'open a ticket about late payment')?.payload.priority === 'HIGH');
check('create_ticket bad id dropped', actionOf({ type: 'action', intent: 'create_ticket', subject: 'x', priority: 'WHATEVER', identifier: 'nope' }, admin, 'open a ticket')?.payload.identifier === undefined);
check('create_subscriber draft is server-generated', (() => { const r = actionOf({ type: 'action', intent: 'create_subscriber' }, admin, 'create a subscriber with random credentials'); return !!(r && /^ai-[0-9a-f]{10}$/.test(r.payload.username) && r.payload.password.length >= 8 && r.payload.status === 'PENDING'); })());
check('create_subscriber restricted', actionOf({ type: 'action', intent: 'create_subscriber' }, reseller, 'create a subscriber') === undefined);
check('unknown intent rejected', actionOf({ type: 'action', intent: 'delete_everything' }, admin, 'delete everything') === undefined);
check('invalid JSON rejected', ai.externalActionFromLLM('not json at all', admin, 'suspend rasel', ids) === undefined);
check('case-insensitive id + lowercase status', actionOf({ type: 'action', intent: 'set_subscriber_status', identifier: 'RASEL', status: 'suspend' }, admin, 'suspend RASEL')?.payload.status === 'SUSPENDED');
check('phone id in allowlist', actionOf({ type: 'action', intent: 'set_subscriber_status', identifier: '20455030110', status: 'SUSPENDED' }, admin, 'suspend phone 20455030110')?.payload.identifier === '20455030110');
check('empty subject rejected', actionOf({ type: 'action', intent: 'create_ticket', subject: '  ' }, admin, 'open a ticket') === undefined);

/* ---------------- detectIntent: new commands ---------------- */
check('detect: suspend rasel', ai.detectIntent('suspend rasel').intent === 'set_subscriber_status');
check('detect: pay rasel 500 → record_payment', ai.detectIntent('pay rasel 500').intent === 'record_payment');
check('detect: assign addon plan to rasel → assign_package', (() => { const d = ai.detectIntent('assign addon plan to rasel'); return d.intent === 'assign_package' && d.action.payload.identifier === 'rasel' && d.action.payload.package_name === 'addon'; })());
check('detect: close ticket TKT-000123 → close_ticket', (() => { const d = ai.detectIntent('close ticket TKT-000123'); return d.intent === 'close_ticket' && d.action.payload.ticket_no === 'TKT-000123'; })());
check('detect: approve kyc of rasel → approve_kyc', ai.detectIntent('approve kyc of rasel').intent === 'approve_kyc');
check('detect: reject kyc of rasel → reject_kyc', ai.detectIntent('reject kyc of rasel').intent === 'reject_kyc');
check('detect: top up wallet of cybernet with 500 → topup_reseller_wallet', ai.detectIntent('top up wallet of cybernet with 500').intent === 'topup_reseller_wallet');
check('detect: question is not a command', ai.detectIntent('is rasel active?').intent === 'free_form' || ai.detectIntent('is rasel active?').intent === 'customer_lookup');

/* ---------------- render ---------------- */
const ctxAdmin = admin;
check('render: set_subscriber_status mentions SUSPENDED', ai.render('set_subscriber_status', 'en', {}, [], ctxAdmin, 'rasel', undefined, { type: 'set_subscriber_status', payload: { identifier: 'rasel', status: 'SUSPENDED' } }).reply.includes('SUSPENDED'));
check('render: record_payment shows amount', ai.render('record_payment', 'en', {}, [], ctxAdmin, undefined, undefined, { type: 'record_payment', payload: { identifier: 'rasel', amount: 500, gateway: 'bkash' } }).reply.includes('500'));
check('render: assign_package mentions addon', ai.render('assign_package', 'en', {}, [], ctxAdmin, undefined, undefined, { type: 'assign_package', payload: { identifier: 'rasel', package_name: 'addon' } }).reply.includes('addon'));
check('render: close_ticket mentions ticket', ai.render('close_ticket', 'en', {}, [], ctxAdmin, undefined, undefined, { type: 'close_ticket', payload: { ticket_no: 'TKT-000123', status: 'CLOSED' } }).reply.includes('Closing ticket'));
check('render: approve_kyc mentions approve', ai.render('approve_kyc', 'en', {}, [], ctxAdmin, 'rasel', undefined, { type: 'approve_kyc', payload: { identifier: 'rasel' } }).reply.toLowerCase().includes('approv'));
check('render: reject_kyc mentions reject', ai.render('reject_kyc', 'en', {}, [], ctxAdmin, 'rasel', undefined, { type: 'reject_kyc', payload: { identifier: 'rasel' } }).reply.toLowerCase().includes('reject'));

/* ---------------- askAI smoke (local engine, fake pool) ---------------- */
(async () => {
  const r0 = await ai.askAI(fakePool, admin, 'hello');
  check('askAI: hello → greeting', r0.intent === 'greeting');
  const r1 = await ai.askAI(fakePool, admin, 'suspend rasel');
  check('askAI: suspend rasel → action', r1.action?.type === 'set_subscriber_status');
  const r2 = await ai.askAI(fakePool, admin, 'pay rasel 500');
  check('askAI: pay rasel 500 → record_payment action', r2.action?.type === 'record_payment');
  const r3 = await ai.askAI(fakePool, admin, 'create a ticket about late payment');
  check('askAI: ticket about late payment → create_ticket action', r3.action?.type === 'create_ticket');
  const r4 = await ai.askAI(fakePool, admin, 'is rasel online?');
  check('askAI: question → no action, intent set', r4.action === undefined);
  const r5 = await ai.askAI(fakePool, reseller, 'suspend rasel');
  check('askAI: restricted role → no action', r5.action === undefined && r5.meta.restricted);

  check('testExternalProvider: openai with empty key → ok false', (await ai.testExternalProvider('openai', '')).ok === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('askAI smoke error:', e); process.exit(1); });
