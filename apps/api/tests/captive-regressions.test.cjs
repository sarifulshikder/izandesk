'use strict';
/* Regression tests for the public captive expiry portal (router-redirected
 * "subscription expired — please recharge" page):
 *  - captive token issue/verify scoping
 *  - caller-IP resolution (X-Forwarded-For only trusted behind a local proxy)
 *  - subscriber lookup by session IP and by identifier
 *  - captive view (expired flag, due invoice)
 *  - captive ticket creation (source CAPTIVE_PORTAL, validation)
 *  - captive checkout (amount validation, invoice ownership)
 * Run: node tests/captive-regressions.test.cjs (requires: pnpm --filter api build first) */
const captive = require('../dist/integrations/captive.js');
const portalPayments = require('../dist/integrations/portal-payments.js');
const db = require('../dist/db/index.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
}
const has = (call, fragment) => call.sql.includes(fragment);

function makeDb(handlers) {
  const calls = [];
  const original = db.pool.query;
  db.pool.query = async function (text, params) {
    const call = { sql: String(text).replace(/\s+/g, ' ').trim(), params: params || [] };
    calls.push(call);
    for (const h of handlers) {
      if (!h.when(call)) continue;
      const out = typeof h.return === 'function' ? h.return(call) : h.return;
      if (out && out.throw) throw out.throw;
      return out;
    }
    return { rows: [] };
  };
  return { calls, restore: () => { db.pool.query = original; } };
}

const SUB_ROW = {
  id: 'sub-1', client_code: 'IZN-00001', full_name: 'Test User', username: 'test@isp',
  phone: '01700000000', package_name: '10Mbps', bandwidth_mbps: 10, monthly_bill: '500.00',
  current_due: '500.00', expiry_date: '2026-11-01', due_date: '2026-11-01', status: 'EXPIRED',
  suspension_stage: 'ISOLATED', walled_garden: false, address: 'Dhaka', provisioning_mode: 'ROUTER',
};

async function tokenTests() {
  const t = captive.issueCaptiveToken('sub-1');
  const p = captive.verifyCaptiveToken(t);
  check('captive: token roundtrip resolves subscriber id', p && p.sub === 'sub-1');
  check('captive: garbage token rejected', captive.verifyCaptiveToken('not-a-token') === null);
  // a portal token must NOT be accepted as a captive token
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'izandesk-dev-secret-change-me';
  const portalTok = jwt.sign({ type: 'PORTAL_SUBSCRIBER', sub: 'sub-1', ver: 'x' }, secret);
  check('captive: portal token not accepted as captive token', captive.verifyCaptiveToken(portalTok) === null);
}

function callerIpTests() {
  const pub = captive.callerIp({ ip: '203.0.113.9', headers: { 'x-forwarded-for': '10.9.9.9' } });
  check('captive: public peer — socket IP wins over XFF (anti-spoof)', pub === '203.0.113.9');
  const priv = captive.callerIp({ ip: '172.18.0.5', headers: { 'x-forwarded-for': '172.30.1.80, 10.0.0.1' } });
  check('captive: local proxy — first XFF entry used', priv === '172.30.1.80');
  const v6 = captive.callerIp({ ip: '::ffff:203.0.113.9', headers: {} });
  check('captive: ::ffff: prefix stripped', v6 === '203.0.113.9');
}

async function lookupTests() {
  const fake = makeDb([
    { when: (c) => has(c, 'JOIN subscriber_sessions'), return: { rows: [SUB_ROW] } },
  ]);
  try {
    const sub = await captive.findSubscriberByIp('172.30.1.80');
    check('captive: findSubscriberByIp matches live session IP', sub && sub.id === 'sub-1');
    const call = fake.calls.find((c) => has(c, 'JOIN subscriber_sessions'));
    check('captive: session lookup filters ONLINE + ip param', call && call.params[0] === '172.30.1.80' && /upper\(ss\.status\) = 'ONLINE'/.test(call.sql));
  } finally { fake.restore(); }

  const fake2 = makeDb([
    { when: (c) => has(c, 'JOIN radacct'), return: { rows: [SUB_ROW] } },
  ]);
  try {
    const sub = await captive.findSubscriberByIp('10.10.10.5');
    check('captive: findSubscriberByIp falls back to radacct framed IP', sub && sub.username === 'test@isp');
  } finally { fake2.restore(); }

  const fake3 = makeDb([
    { when: (c) => has(c, 'lower(s.client_code)'), return: { rows: [SUB_ROW] } },
  ]);
  try {
    const sub = await captive.findSubscriberByIdentifier('izn-00001');
    check('captive: findSubscriberByIdentifier matches client code case-insensitively', sub && sub.client_code === 'IZN-00001');
    const call = fake3.calls.find((c) => has(c, 'lower(s.client_code)'));
    check('captive: identifier lookup covers code/username/phone', call && has(call, 'lower(s.username)') && has(call, 's.phone = $1'));
  } finally { fake3.restore(); }
}

async function viewTests() {
  const fake = makeDb([
    { when: (c) => has(c, 'FROM bandwidth_packages'), return: { rows: [{ id: 'p1', name: '10Mbps', price: '500.00', download_mbps: 10, upload_mbps: 2, validity_value: 1, validity_unit: 'month' }] } },
    { when: (c) => has(c, 'FROM invoices') && has(c, "'UNPAID','PARTIAL','OVERDUE'"), return: { rows: [{ id: 'inv-1', invoice_number: 'INV-0001', due_amount: '500.00', status: 'OVERDUE' }] } },
  ]);
  try {
    const view = await captive.buildCaptiveView({ ...SUB_ROW });
    check('captive: view marks expired subscriber', view.expired === true && view.restricted === true);
    check('captive: view includes package + due invoice', view.package?.name === '10Mbps' && view.due_invoice?.invoice_number === 'INV-0001');
    check('captive: view strips credentials', view.subscriber.password === undefined && view.subscriber.portal_password === undefined);
    const active = await captive.buildCaptiveView({ ...SUB_ROW, status: 'ACTIVE', expiry_date: '2999-01-01', current_due: '0' });
    check('captive: active subscriber not flagged expired', active.expired === false);
  } finally { fake.restore(); }
}

async function ticketTests() {
  const fake = makeDb([
    { when: (c) => has(c, 'FROM subscribers WHERE id=$1'), return: { rows: [{ ...SUB_ROW, latitude: null, longitude: null, reseller_id: null }] } },
    { when: (c) => has(c, "nextval('ticket_no_seq')"), return: { rows: [{ n: 42 }] } },
    { when: (c) => has(c, 'INSERT INTO tickets'), return: (c) => ({ rows: [{ id: 't-1', ticket_no: 'TKT-000042', subject: c.params[3] }] }) },
    { when: (c) => has(c, 'INSERT INTO audit_log') || has(c, 'audit'), return: { rows: [] } },
  ]);
  try {
    const t = await captive.createCaptiveTicket({ subscriberId: 'sub-1', subject: 'Cannot pay', description: 'bKash failed', ip: '172.30.1.80' });
    const ins = fake.calls.find((c) => has(c, 'INSERT INTO tickets'));
    check('captive: ticket created with CAPTIVE_PORTAL source', !!ins && has(ins, "'CAPTIVE_PORTAL'"));
    check('captive: ticket number from sequence', t.ticket_no === 'TKT-000042');
    let threw = false;
    try { await captive.createCaptiveTicket({ subscriberId: 'sub-1', subject: '  ' }); } catch (e) { threw = e.status === 400; }
    check('captive: empty subject rejected with 400', threw);
  } finally { fake.restore(); }
}

async function checkoutTests() {
  const previousSandboxFlag = process.env.PORTAL_SANDBOX_CHECKOUT;
  process.env.PORTAL_SANDBOX_CHECKOUT = '1';
  const fake = makeDb([
    { when: (c) => has(c, 'FROM invoices WHERE id=$1 AND subscriber_id=$2'), return: (c) => c.params[0] === 'inv-1' ? { rows: [{ id: 'inv-1', subscriber_id: 'sub-1', due_amount: '500.00', total_amount: '500.00' }] } : { rows: [] } },
    { when: (c) => has(c, 'FROM subscribers WHERE id=$1'), return: { rows: [SUB_ROW] } },
    // Public checkout fails closed unless the gateway is explicitly enabled;
    // SANDBOX mode is what makes the simulated URL available in this regression.
    { when: (c) => has(c, 'FROM payment_gateway_configs'), return: { rows: [{ gateway: 'bkash', enabled: true, mode: 'SANDBOX', config: {}, credentials: {} }] } },
    { when: (c) => has(c, 'INSERT INTO payments'), return: (c) => ({ rows: [{ id: 'pay-1', payment_ref: c.params[0], amount: c.params[5], status: 'PENDING' }] }) },
  ]);
  try {
    const r = await portalPayments.createCheckoutForSubscriber('sub-1', { gateway: 'bkash', invoice_id: 'inv-1' });
    const ins = fake.calls.find((c) => has(c, 'INSERT INTO payments'));
    check('captive: checkout creates PENDING payment for invoice due amount', !!ins && Number(ins.params[5]) === 500 && has(ins, "'PENDING'"));
    check('captive: simulated checkout URL returned', !!r.checkout?.paymentUrl);
    let threw = false;
    try { await portalPayments.createCheckoutForSubscriber('sub-1', { gateway: 'bkash', amount: 0 }); } catch (e) { threw = e.status === 400; }
    check('captive: zero amount rejected with 400', threw);
    let notFound = false;
    try { await portalPayments.createCheckoutForSubscriber('sub-1', { gateway: 'bkash', invoice_id: 'inv-other' }); } catch (e) { notFound = e.status === 404; }
    check('captive: invoice of another subscriber rejected with 404', notFound);
  } finally {
    fake.restore();
    if (previousSandboxFlag === undefined) delete process.env.PORTAL_SANDBOX_CHECKOUT;
    else process.env.PORTAL_SANDBOX_CHECKOUT = previousSandboxFlag;
  }
}

(async () => {
  await tokenTests();
  callerIpTests();
  await lookupTests();
  await viewTests();
  await ticketTests();
  await checkoutTests();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
