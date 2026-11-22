'use strict';
/* Regression tests for the high-risk auth/payment security fixes:
 * - purpose-specific JWTs must never authenticate staff requests
 * - webhook HMAC must be verified against the exact request bytes
 * - a webhook not bound to a PENDING checkout must not record a payment
 * - a disabled gateway must not create a simulated checkout
 * Run: node tests/security-regressions.test.cjs (requires: pnpm --filter api build first) */
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { verifyStaffToken, verifyPurposeToken } = require('../dist/security/staff-tokens.js');
const { enabled, ipAllowed } = require('../dist/security/guards.js');
const db = require('../dist/db/index.js');
const billingRouter = require('../dist/routes/billing.js').default;

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

async function postBilling(handlers, path, payload, headers = {}, rawBody) {
  const fake = makeDb(handlers);
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use((req, _res, next) => {
    req.user = { id: 'u1', email: 'admin@example.com', name: 'Admin', role: 'SUPER_ADMIN' };
    next();
  });
  app.use('/api/billing', billingRouter);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close', ...headers },
      body: rawBody !== undefined ? rawBody : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body, calls: fake.calls };
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fake.restore();
  }
}

/* ---------------- staff vs purpose-specific tokens ---------------- */
const SECRET = 'regression-test-secret';
const staffToken = jwt.sign({ sub: 'u1', role: 'SUPER_ADMIN' }, SECRET);
check('staff token accepted', verifyStaffToken(staffToken, SECRET).sub === 'u1');
check('staff token preserves role', verifyStaffToken(staffToken, SECRET).role === 'SUPER_ADMIN');

const rejectsAsStaff = (token) => {
  try { verifyStaffToken(token, SECRET); return false; } catch { return true; }
};
check('mfa challenge rejected as staff token', rejectsAsStaff(jwt.sign({ sub: 'u1', purpose: 'mfa' }, SECRET)));
check('mfa enrollment token rejected as staff token', rejectsAsStaff(jwt.sign({ sub: 'u1', purpose: 'mfa_enrollment' }, SECRET)));
check('step-up token rejected as staff token', rejectsAsStaff(jwt.sign({ sub: 'u1', type: 'step_up' }, SECRET)));
check('portal token rejected as staff token', rejectsAsStaff(jwt.sign({ sub: 'u1', aud: 'portal' }, SECRET)));
check('token without sub rejected', rejectsAsStaff(jwt.sign({ role: 'SUPER_ADMIN' }, SECRET)));
check('token with unknown role rejected', rejectsAsStaff(jwt.sign({ sub: 'u1', role: 'PORTAL_USER' }, SECRET)));
check('tampered staff token rejected', rejectsAsStaff(`${staffToken}tampered`));

check('purpose token accepted for correct purpose', verifyPurposeToken(jwt.sign({ sub: 'u1', purpose: 'mfa_enrollment' }, SECRET), SECRET, 'mfa_enrollment') === 'u1');
check('purpose token rejected for other purpose', verifyPurposeToken(jwt.sign({ sub: 'u1', purpose: 'mfa' }, SECRET), SECRET, 'mfa_enrollment') === null);
check('staff token rejected as purpose token', verifyPurposeToken(staffToken, SECRET, 'mfa') === null);
check('missing purpose token returns null', verifyPurposeToken(undefined, SECRET, 'mfa') === null);

/* ---------------- small guards used by the hardening pass ---------------- */
check('enabled: TRUE', enabled('TRUE') === true);
check('enabled: 1', enabled('1') === true);
check('enabled: false', enabled('false') === false);
check('ipAllowed: empty list allows all', ipAllowed('1.2.3.4', []) === true);
check('ipAllowed: exact match', ipAllowed('1.2.3.4', ['1.2.3.4']) === true);
check('ipAllowed: CIDR match', ipAllowed('10.77.0.15', ['10.77.0.0/24']) === true);
check('ipAllowed: CIDR miss', ipAllowed('10.78.0.15', ['10.77.0.0/24']) === false);

(async () => {
  /* ---------------- webhook HMAC / pending-payment binding ---------------- */
  const payload = { event_id: 'evt-1', payment_ref: 'PAY-1', amount: 70, status: 'COMPLETED' };
  const compact = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', 'whsec').update(compact).digest('hex');
  const gatewayCfg = {
    when: (c) => has(c, 'SELECT * FROM payment_gateway_configs WHERE gateway=$1'),
    return: { rows: [{ gateway: 'bkash', enabled: true, webhook_secret: 'whsec' }] },
  };
  const failedEventInsert = {
    when: (c) => has(c, 'INSERT INTO payment_webhook_events'),
    return: { rows: [{}] },
  };

  const badSig = await postBilling(
    [gatewayCfg, failedEventInsert],
    '/api/billing/webhooks/bkash',
    payload,
    { 'x-signature': 'sha256=deadbeef' },
  );
  check('webhook: invalid HMAC rejected', badSig.status === 401 && badSig.body.verified === false);
  check('webhook: invalid HMAC records no payment', !badSig.calls.some((c) => has(c, 'INSERT INTO payments')));

  // Same parsed JSON, different bytes: the signature is over `compact`, so a
  // pretty-printed body must fail. This proves verification uses rawBody.
  const whitespaceTamper = await postBilling(
    [gatewayCfg, failedEventInsert],
    '/api/billing/webhooks/bkash',
    payload,
    { 'x-signature': signature },
    JSON.stringify(payload, null, 2),
  );
  check('webhook: raw-body mismatch rejected', whitespaceTamper.status === 401 && whitespaceTamper.body.verified === false);

  const unbound = await postBilling(
    [
      gatewayCfg,
      { when: (c) => has(c, "SELECT * FROM payments WHERE payment_ref=$1 AND status='PENDING'"), return: { rows: [] } },
      { when: (c) => has(c, 'SELECT id, result, processed FROM payment_webhook_events WHERE dedupe_key'), return: { rows: [] } },
      { when: (c) => has(c, 'INSERT INTO payment_webhook_events'), return: { rows: [{ id: 'evt-row' }] } },
      { when: (c) => has(c, 'UPDATE payment_webhook_events SET processed=true'), return: { rows: [] } },
    ],
    '/api/billing/webhooks/bkash',
    payload,
    { 'x-signature': signature },
  );
  check('webhook: valid HMAC accepted', unbound.status === 200 && unbound.body.ok === true);
  check('webhook: event without PENDING checkout not verified', unbound.body.verified === false && unbound.body.processed === false);
  check('webhook: unbound event records no payment', !unbound.calls.some((c) => has(c, 'INSERT INTO payments')));

  /* ---------------- disabled gateway checkout ---------------- */
  const disabled = await postBilling(
    [
      { when: (c) => has(c, 'SELECT * FROM payment_gateway_configs WHERE gateway=$1'), return: { rows: [{ gateway: 'bkash', enabled: false, mode: 'SANDBOX' }] } },
      { when: (c) => has(c, 'SELECT * FROM invoices WHERE id=$1'), return: { rows: [{ id: 'i1', subscriber_id: 's1', due_amount: 100, total_amount: 100 }] } },
      { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1'), return: { rows: [{ id: 's1', full_name: 'Test' }] } },
    ],
    '/api/billing/payments/checkout',
    { gateway: 'bkash', invoice_id: 'i1' },
  );
  check('checkout: disabled gateway returns 403', disabled.status === 403);
  check('checkout: disabled gateway explains why', /disabled/i.test(String(disabled.body.message || '')));
  check('checkout: disabled gateway creates no pending payment', !disabled.calls.some((c) => has(c, 'INSERT INTO payments')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
