'use strict';
/* Regressions for package-driven expiry / self-service reactivation:
 *  - an online PACKAGE_PURCHASE is one payment, not gateway + synthetic admin recharge
 *  - a package purchase restores validity even when unrelated dues remain,
 *    without settling invoices or consuming advance credit
 *  - portal/captive state uses the same inclusive business-day expiry rule as
 *    the due-policy engine
 *  - failed RADIUS/MikroTik provisioning is retried from the enforcement outbox
 * Run: node tests/package-purchase-regressions.test.cjs (requires pnpm --filter api build first) */
const billing = require('../dist/integrations/billing.js');
const portalPayments = require('../dist/integrations/portal-payments.js');
const settings = require('../dist/integrations/settings.js');
const db = require('../dist/db/index.js');

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const has = (call, fragment) => call.sql.includes(fragment);

function makeDb(handlers) {
  const calls = [];
  const originalQuery = db.pool.query;
  const originalConnect = db.pool.connect;
  const runner = async function (text, params) {
    const call = { sql: String(text).replace(/\s+/g, ' ').trim(), params: params || [] };
    calls.push(call);
    for (const h of handlers) {
      if (!h.when(call)) continue;
      const out = typeof h.return === 'function' ? h.return(call) : h.return;
      if (out && out.throw) throw out.throw;
      return out;
    }
    return { rows: [], rowCount: 0 };
  };
  db.pool.query = runner;
  db.pool.connect = async () => ({ query: runner, release: () => {} });
  return { calls, restore: () => { db.pool.query = originalQuery; db.pool.connect = originalConnect; } };
}

const settingsHandlers = [
  { when: (c) => has(c, 'SELECT key, value FROM settings'), return: { rows: [] } },
  { when: (c) => has(c, 'INSERT INTO settings'), return: { rows: [] } },
];

const CREATED_EXPIRED_SUB = {
  id: 'sub-create', client_code: 'CE-1', username: 'ce1', full_name: 'Created Expired',
  status: 'EXPIRED', suspension_stage: 'ISOLATED', suspension_source: 'CREATION', walled_garden: false,
  package_name: 'P500', monthly_bill: 500, expiry_date: '2020-01-01', price_override: null,
  provisioning_mode: 'RADIUS', router_id: null,
};
const EXPIRED_SUB = {
  ...CREATED_EXPIRED_SUB, id: 'sub-expired', suspension_source: 'POLICY', client_code: 'EX-1', username: 'ex1',
};
const PKG = { id: 'pkg-1', name: 'P500', price: 500, validity_value: 1, validity_unit: 'CALENDAR_MONTH', profile_name: 'P500' };

function purposeHandlers(sub) {
  return [
    ...settingsHandlers,
    { when: (c) => has(c, 'WITH meta AS') && has(c, 'meta.purpose'), return: { rows: [{ purpose: 'PACKAGE_PURCHASE', package_id: 'pkg-1', meta_purpose: null, meta_package_id: null }] } },
    { when: (c) => has(c, 'SELECT * FROM payments WHERE payment_ref=$1 FOR UPDATE'), return: { rows: [{ ...COMPLETED_PAYMENT }] } },
    { when: (c) => has(c, "SELECT * FROM payments WHERE gateway=$1 AND trx_id=$2 AND status='COMPLETED'"), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT * FROM payments WHERE idempotency_key=$1'), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT * FROM payments WHERE payment_ref=$1'), return: { rows: [{ ...PENDING_PAYMENT }] } },
    { when: (c) => has(c, 'SELECT * FROM invoices WHERE id=$1'), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT status, suspension_stage, walled_garden, suspension_source, package_name FROM subscribers'), return: { rows: [sub] } },
    { when: (c) => has(c, 'SELECT price FROM bandwidth_packages WHERE id=$1'), return: { rows: [{ price: PKG.price }] } },
    { when: (c) => has(c, 'SELECT price FROM bandwidth_packages WHERE name=$1'), return: { rows: [{ price: PKG.price }] } },
    { when: (c) => has(c, 'SELECT price, validity_value, validity_unit FROM bandwidth_packages WHERE id=$1'), return: { rows: [PKG] } },
    { when: (c) => has(c, 'SELECT price, validity_value, validity_unit FROM bandwidth_packages WHERE name=$1'), return: { rows: [PKG] } },
    { when: (c) => has(c, 'COALESCE(SUM(GREATEST(due_amount,0))'), return: { rows: [{ due: 300 }] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1 FOR UPDATE'), return: { rows: [sub] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1'), return: { rows: [sub] } },
    { when: (c) => has(c, 'FROM subscribers s LEFT JOIN bandwidth_packages bp'), return: { rows: [sub] } },
  ];
}
const PENDING_PAYMENT = {
  id: 'pay-1', payment_ref: 'PORTAL-PKG-1', subscriber_id: 'sub-create', amount: 500,
  status: 'PENDING', purpose: 'PACKAGE_PURCHASE', package_id: 'pkg-1',
};
const COMPLETED_PAYMENT = { ...PENDING_PAYMENT, status: 'COMPLETED' };

async function createdExpiredGatewayPaymentIsReused() {
  settings.invalidateCache();
  const fake = makeDb([
    ...purposeHandlers(CREATED_EXPIRED_SUB),
    { when: (c) => has(c, 'INSERT INTO payments'), return: (c) => ({ rows: [{ ...COMPLETED_PAYMENT, payment_ref: c.params[0] }] }) },
  ]);
  try {
    const result = await billing.recordPaymentAndReactivate({
      gateway: 'bkash', amount: 500, subscriber_id: 'sub-create', trx_id: 'TRX-CREATE-1',
      payment_ref: 'PORTAL-PKG-1', purpose: 'PACKAGE_PURCHASE', package_id: 'pkg-1', status: 'COMPLETED',
    });
    const inserts = fake.calls.filter((c) => has(c, 'INSERT INTO payments'));
    const synthetic = inserts.filter((c) => c.params.some((p) => String(p).startsWith('ADM-RECHARGE-')));
    const walletInserts = fake.calls.filter((c) => has(c, 'INSERT INTO wallet_transactions'));
    check('created-EXPIRED online purchase activates', result.ok === true && !!result.reactivation);
    check('created-EXPIRED online purchase records exactly one payment', inserts.length === 1 && synthetic.length === 0);
    check('created-EXPIRED online purchase posts one wallet credit', walletInserts.length === 1);
    check('created-EXPIRED online purchase enqueues enforcement', fake.calls.some((c) => has(c, 'INSERT INTO enforcement_outbox')));
  } finally { fake.restore(); }
}

async function packagePurchaseIgnoresUnrelatedDues() {
  settings.invalidateCache();
  const fake = makeDb([
    ...purposeHandlers(EXPIRED_SUB),
    { when: (c) => has(c, 'INSERT INTO payments'), return: { rows: [COMPLETED_PAYMENT] } },
  ]);
  try {
    const result = await billing.recordPaymentAndReactivate({
      gateway: 'bkash', amount: 500, subscriber_id: 'sub-expired', trx_id: 'TRX-EXPIRED-1',
      payment_ref: 'PORTAL-PKG-2', purpose: 'PACKAGE_PURCHASE', package_id: 'pkg-1', status: 'COMPLETED',
    });
    const stateUpdate = fake.calls.find((c) => has(c, 'UPDATE subscribers SET expiry_date'));
    const invoiceUpdates = fake.calls.filter((c) => has(c, 'UPDATE invoices'));
    const creditUpdates = fake.calls.filter((c) => has(c, 'excess_amount=COALESCE(excess_amount,0)+'));
    const dueDateChange = stateUpdate && /due_date=CASE WHEN \$5::boolean AND NOT \$6::boolean/.test(stateUpdate.sql);
    check('package purchase with unrelated dues still renews', result.ok === true && !!result.reactivation);
    check('package purchase does not settle invoices', invoiceUpdates.length === 0);
    check('package purchase does not create advance credit', creditUpdates.length === 0);
    check('package purchase leaves collections due_date untouched', !!dueDateChange && stateUpdate.params[5] === true);
    check('package purchase preserves existing advance credit', stateUpdate.sql.includes('NOT $6::boolean THEN 0 ELSE excess_amount END'));
  } finally { fake.restore(); }
}

async function portalStateUsesBusinessExpiryDay() {
  settings.invalidateCache();
  const fake = makeDb(settingsHandlers);
  try {
    const today = settings.ymdInTimezone(new Date(), 'Asia/Dhaka');
    const onExpiryDay = await portalPayments.describePortalState({
      status: 'ACTIVE', suspension_stage: 'NONE', expiry_date: today, current_due: 0,
    });
    const future = await portalPayments.describePortalState({
      status: 'ACTIVE', suspension_stage: 'NONE', expiry_date: '2999-01-01', current_due: 0,
    });
    check('portal marks subscriber expired ON business expiry day', onExpiryDay.normalized_state === 'EXPIRED');
    check('portal keeps future-dated subscriber active', future.normalized_state === 'ACTIVE');
  } finally { fake.restore(); }
}

async function enforcementOutboxRetriesProvisioning() {
  const sub = { ...EXPIRED_SUB, id: 'sub-outbox', status: 'ACTIVE', suspension_stage: 'NONE', suspension_source: 'NONE', walled_garden: false, username: null, router_id: null };
  const fake = makeDb([
    ...settingsHandlers,
    { when: (c) => has(c, "UPDATE enforcement_outbox SET status='FAILED'"), return: { rows: [] } },
    { when: (c) => has(c, 'FOR UPDATE SKIP LOCKED'), return: { rows: [{ id: 'job-1', subscriber_id: sub.id, payload: { status: 'ACTIVE', stage: 'NONE', walled_garden: false, reason: 'test', sendCoa: false }, attempts: 0 }] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1 FOR UPDATE'), return: { rows: [sub] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1'), return: { rows: [sub] } },
    { when: (c) => has(c, 'FROM subscribers s LEFT JOIN bandwidth_packages bp'), return: { rows: [sub] } },
    { when: (c) => has(c, "UPDATE enforcement_outbox SET status='DONE'"), return: { rows: [] } },
  ]);
  try {
    const result = await billing.processEnforcementOutbox();
    const done = fake.calls.find((c) => has(c, "UPDATE enforcement_outbox SET status='DONE'"));
    check('outbox worker claims due enforcement jobs', result.claimed === 1);
    check('outbox worker completes successful enforcement', result.done === 1 && !!done && done.params[0] === 'job-1');
  } finally { fake.restore(); }
}

async function outboxKeepsFailedProvisioningRetryable() {
  const sub = { ...EXPIRED_SUB, id: 'sub-outbox-fail', status: 'ACTIVE', suspension_stage: 'NONE', suspension_source: 'NONE', walled_garden: false, provisioning_mode: 'RADIUS', router_id: null };
  const fake = makeDb([
    ...settingsHandlers,
    { when: (c) => has(c, "UPDATE enforcement_outbox SET status='FAILED', attempts=LEAST"), return: { rows: [] } },
    { when: (c) => has(c, 'FOR UPDATE SKIP LOCKED'), return: { rows: [{ id: 'job-2', subscriber_id: sub.id, payload: { status: 'ACTIVE', stage: 'NONE', walled_garden: false, reason: 'test', sendCoa: false }, attempts: 0 }] } },
    { when: (c) => has(c, 'INSERT INTO radius_users'), return: { throw: new Error('simulated RADIUS outage') } },
    { when: (c) => has(c, "UPDATE enforcement_outbox SET status='FAILED', attempts=$2"), return: { rows: [] } },
    { when: (c) => has(c, "UPDATE enforcement_outbox SET status='DONE'"), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1 FOR UPDATE'), return: { rows: [sub] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1'), return: { rows: [sub] } },
    { when: (c) => has(c, 'FROM subscribers s LEFT JOIN bandwidth_packages bp'), return: { rows: [sub] } },
  ]);
  try {
    const result = await billing.processEnforcementOutbox();
    const failed = fake.calls.find((c) => has(c, "UPDATE enforcement_outbox SET status='FAILED', attempts=$2"));
    const done = fake.calls.find((c) => has(c, "UPDATE enforcement_outbox SET status='DONE'"));
    check('outbox does not mark failed provisioning DONE', result.done === 0 && !done);
    check('outbox retries failed provisioning with backoff', result.retried === 1 && !!failed && failed.params[3] === 30);
    check('outbox records the failed projection', !!failed && String(failed.params[2]).includes('radius_sync'));
  } finally { fake.restore(); }
}

async function outboxTerminalizesAfterEightAttempts() {
  const sub = { ...EXPIRED_SUB, id: 'sub-outbox-terminal', status: 'ACTIVE', suspension_stage: 'NONE', suspension_source: 'NONE', walled_garden: false, provisioning_mode: 'RADIUS', router_id: null };
  const fake = makeDb([
    ...settingsHandlers,
    { when: (c) => has(c, "UPDATE enforcement_outbox SET status='FAILED', attempts=LEAST"), return: { rows: [] } },
    { when: (c) => has(c, 'FOR UPDATE SKIP LOCKED'), return: { rows: [{ id: 'job-3', subscriber_id: sub.id, payload: { status: 'ACTIVE', stage: 'NONE', walled_garden: false, reason: 'test', sendCoa: false }, attempts: 7 }] } },
    { when: (c) => has(c, 'INSERT INTO radius_users'), return: { throw: new Error('simulated RADIUS outage') } },
    { when: (c) => has(c, "UPDATE enforcement_outbox SET status='FAILED', attempts=$2"), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1 FOR UPDATE'), return: { rows: [sub] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1'), return: { rows: [sub] } },
    { when: (c) => has(c, 'FROM subscribers s LEFT JOIN bandwidth_packages bp'), return: { rows: [sub] } },
  ]);
  try {
    const result = await billing.processEnforcementOutbox();
    const failed = fake.calls.find((c) => has(c, "UPDATE enforcement_outbox SET status='FAILED', attempts=$2"));
    check('outbox stops retrying after eight attempts', result.failed === 1 && result.retried === 0);
    check('outbox marks the terminal attempt explicitly', !!failed && failed.params[1] === 8 && String(failed.params[2]).startsWith('[terminal]'));
  } finally { fake.restore(); }
}

async function webhookAmountBindingRejectsShortPackagePayment() {
  const packageRow = { amount: 500, purpose: 'PACKAGE_PURCHASE', gateway_response: null };
  const invoiceRow = { amount: 500, purpose: 'INVOICE_PAYMENT', gateway_response: null };
  check('package webhook rejects underpayment', billing.webhookAmountMatchesPayment(packageRow, 100) === false);
  check('package webhook accepts exact price', billing.webhookAmountMatchesPayment(packageRow, 500) === true);
  check('package webhook rejects overpayment', billing.webhookAmountMatchesPayment(packageRow, 501) === false);
  check('invoice webhook still accepts partial payment', billing.webhookAmountMatchesPayment(invoiceRow, 100) === true);
  check('webhook amount binding rejects missing payment row', billing.webhookAmountMatchesPayment(null, 500) === false);
}

(async () => {
  await createdExpiredGatewayPaymentIsReused();
  await packagePurchaseIgnoresUnrelatedDues();
  await portalStateUsesBusinessExpiryDay();
  await enforcementOutboxRetriesProvisioning();
  await outboxKeepsFailedProvisioningRetryable();
  await outboxTerminalizesAfterEightAttempts();
  await webhookAmountBindingRejectsShortPackagePayment();
  console.log(`package-purchase regressions: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
