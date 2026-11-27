'use strict';
/* Regression tests for payment-gated "created-EXPIRED" subscribers:
 *  - created package-assigned subscribers start EXPIRED (blocked), suspension_source='CREATION'
 *  - admin recharge == package price, recorded payment + activation in ONE transaction
 *  - no amount=0 / sub-package-price reactivation; no invoice at activation; no advance credit
 *  - created-EXPIRED excluded from monthly batch invoicing until activated
 *  - unified validity rule computeNewExpiry
 * Run: node tests/created-expired.test.cjs (requires: pnpm --filter api build first) */
const billing = require('../dist/integrations/billing.js');
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
  id: 'sub-ce', full_name: 'Created Expired', client_code: 'CE-1', username: 'ce1', password: 'secret',
  status: 'EXPIRED', suspension_stage: 'ISOLATED', suspension_source: 'CREATION', walled_garden: false,
  package_name: 'P500', monthly_bill: 500, expiry_date: '2020-01-01', price_override: null,
  provisioning_mode: 'RADIUS', router_id: null,
};
const PKG = { name: 'P500', price: 500, validity_value: 1, validity_unit: 'CALENDAR_MONTH', profile_name: 'P500' };

/* ---------- computeNewExpiry ---------- */
async function computeNewExpiryTest() {
  settings.invalidateCache();
  const fake = makeDb(settingsHandlers);
  try {
    const tz = 'Asia/Dhaka'; // getBusinessTimezone default
    const todayYmd = settings.ymdInTimezone(new Date(), tz);
    const base0 = new Date(`${todayYmd}T00:00:00`);
    // CALENDAR_MONTH default +1 month; base=max(today, expiry)
    let r = await billing.computeNewExpiry({ expiry_date: '2000-01-01' }, { validity_unit: 'CALENDAR_MONTH', validity_value: 1 });
    let expected = new Date(base0); expected.setMonth(expected.getMonth() + 1);
    check('computeNewExpiry CALENDAR_MONTH +1 (expired base=today)', r.newExpiry === settings.ymdInTimezone(expected, tz));
    // DAYS
    r = await billing.computeNewExpiry({ expiry_date: '2000-01-01' }, { validity_unit: 'DAYS', validity_value: 30 });
    expected = new Date(base0); expected.setDate(expected.getDate() + 30);
    check('computeNewExpiry DAYS +30', r.newExpiry === settings.ymdInTimezone(expected, tz));
    // future expiry base
    const futureYmd = (() => { const f = new Date(base0); f.setMonth(f.getMonth() + 3); return settings.ymdInTimezone(f, tz); })();
    r = await billing.computeNewExpiry({ expiry_date: futureYmd }, { validity_unit: 'MONTHS', validity_value: 1 });
    const e2 = new Date(`${futureYmd}T00:00:00`); e2.setMonth(e2.getMonth() + 1);
    check('computeNewExpiry base=max(today, expiry)', r.newExpiry === settings.ymdInTimezone(e2, tz));
    // extendDays override
    r = await billing.computeNewExpiry({ expiry_date: '2000-01-01' }, {}, 45);
    expected = new Date(base0); expected.setDate(expected.getDate() + 45);
    check('computeNewExpiry extendDays override', r.newExpiry === settings.ymdInTimezone(expected, tz));
  } finally { fake.restore(); }
}

/* ---------- created-EXPIRED excluded from monthly batch invoicing ---------- */
async function invoicingExclusionTest() {
  settings.invalidateCache();
  const fake = makeDb(settingsHandlers);
  try {
    await billing.runBatchInvoicing({});
    const q = fake.calls.find((c) => has(c, 'SELECT s.* FROM subscribers s WHERE COALESCE(s.monthly_bill,0) > 0'));
    check('runBatchInvoicing excludes created-EXPIRED', !!q && has(q, "NOT (s.status='EXPIRED' AND COALESCE(s.suspension_source,'')='CREATION')"));
    check('runBatchInvoicing still excludes TERMINATED', !!q && has(q, "s.status <> 'TERMINATED'"));
  } finally { fake.restore(); }
}

/* ---------- admin recharge: strict single-transaction activation ---------- */
async function activateCreatedExpiredTest() {
  settings.invalidateCache();
  const fake = makeDb([
    ...settingsHandlers,
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1'), return: () => ({ rows: [CREATED_EXPIRED_SUB] }) },
    { when: (c) => has(c, 'SELECT price, validity_value, validity_unit FROM bandwidth_packages'), return: { rows: [PKG] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1 FOR UPDATE'), return: { rows: [CREATED_EXPIRED_SUB] } },
    { when: (c) => has(c, 'INSERT INTO payments'), return: { rows: [{ id: 'pay-1', payment_ref: 'ADM-RECHARGE-X', amount: 500 }] } },
    { when: (c) => has(c, 'COALESCE(SUM(GREATEST(due_amount,0)),0)::numeric(12,2) as due'), return: { rows: [{ due: 0 }] } },
    { when: (c) => has(c, 'SELECT suspension_source, suspension_reason FROM subscribers'), return: { rows: [{ suspension_source: 'CREATION', suspension_reason: null }] } },
  ]);
  try {
    const r = await billing.renewSubscriber('sub-ce', { method: 'CASH' });
    const calls = fake.calls.map((c) => c.sql);
    const beginIdx = calls.findIndex((s) => s === 'BEGIN');
    const commitIdx = calls.findIndex((s) => s === 'COMMIT');
    const payIdx = calls.findIndex((s) => s.includes('INSERT INTO payments'));
    check('renewSubscriber routes created-EXPIRED -> activateCreatedExpired', r.ok === true && !!r.payment);
    check('payment amount == package price 500', r.amount === 500);
    check('transaction BEGIN ... COMMIT', beginIdx >= 0 && commitIdx > beginIdx);
    const actMatch = calls.find((s) => s.includes("status='ACTIVE'") && s.includes('suspension_stage'));
    check('payment inserted inside transaction', payIdx > beginIdx && payIdx < commitIdx);
    check('subscriber set ACTIVE + suspension_source=NONE + no invoice', !!actMatch && actMatch.includes("suspension_source='NONE'") && !calls.some((s) => s.includes('INSERT INTO invoices')));
    check('no advance-credit prepayment added', !calls.some((s) => s.includes('excess_amount=COALESCE(excess_amount,0)+')));
    check('activation recorded in billing_suspension_logs', calls.some((s) => s.includes('INSERT INTO billing_suspension_logs') && s.includes('REACTIVATED')));
    check('subscriber payment recorded in wallet_transactions', calls.some((s) => s.includes('INSERT INTO wallet_transactions')));
    check('expiry extends package validity', typeof r.expiry_date === 'string' && r.expiry_date > '2020-01-01');
  } finally { fake.restore(); }
}

/* ---------- no amount=0 / sub-price activation on created-EXPIRED ---------- */
async function noFreeActivationTest() {
  settings.invalidateCache();
  // renewSubscriber created-EXPIRED: amount always == package price; nothing caller-controlled
  const fake = makeDb([
    ...settingsHandlers,
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1'), return: { rows: [CREATED_EXPIRED_SUB] } },
    { when: (c) => has(c, 'SELECT price, validity_value, validity_unit FROM bandwidth_packages'), return: { rows: [PKG] } },
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1 FOR UPDATE'), return: { rows: [CREATED_EXPIRED_SUB] } },
    { when: (c) => has(c, 'INSERT INTO payments'), return: { rows: [{ id: 'pay-1', payment_ref: 'X', amount: 500 }] } },
    { when: (c) => has(c, 'COALESCE(SUM(GREATEST(due_amount,0)),0)::numeric(12,2) as due'), return: { rows: [{ due: 0 }] } },
  ]);
  try {
    // caller tries amount=0 / amount=1 — created-EXPIRED ignores it and charges package price
    const r = await billing.renewSubscriber('sub-ce', { amount: 0 });
    check('created-EXPIRED cannot renew amount=0', r.amount === 500);
  } catch { check('created-EXPIRED cannot renew amount=0', true); }
  finally { fake.restore(); }
}

/* ---------- recordPaymentAndReactivate gate for created-EXPIRED ---------- */
async function recordPaymentGateTest() {
  async function run(amount) {
    settings.invalidateCache();
    const fake = makeDb([
      ...settingsHandlers,
      { when: (c) => has(c, 'INSERT INTO payments'), return: { rows: [{ id: 'p', payment_ref: 'P', amount }] } },
      { when: (c) => has(c, 'FROM invoices WHERE subscriber_id') && has(c, "status IN ('UNPAID','PARTIAL','OVERDUE')"), return: { rows: [] } },
      { when: (c) => has(c, 'COALESCE(SUM(GREATEST(due_amount,0)),0)::numeric(12,2) as due'), return: { rows: [{ due: 0 }] } },
      { when: (c) => has(c, 'SELECT status, suspension_stage, walled_garden, suspension_source, package_name FROM subscribers'), return: { rows: [{ status: 'EXPIRED', suspension_stage: 'ISOLATED', walled_garden: false, suspension_source: 'CREATION', package_name: 'P500' }] } },
      { when: (c) => has(c, 'SELECT price FROM bandwidth_packages WHERE name=$1 LIMIT 1'), return: { rows: [{ price: 500 }] } },
      { when: (c) => has(c, 'SELECT suspension_source, suspension_reason FROM subscribers'), return: { rows: [{ suspension_source: 'CREATION', suspension_reason: null }] } },
      { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1'), return: { rows: [CREATED_EXPIRED_SUB] } },
      { when: (c) => has(c, 'FROM subscribers s LEFT JOIN bandwidth_packages bp'), return: { rows: [CREATED_EXPIRED_SUB] } },
    ]);
    try {
      await billing.recordPaymentAndReactivate({ gateway: 'CASH', amount, subscriber_id: 'sub-ce', status: 'COMPLETED' });
      return fake.calls.map((c) => c.sql);
    } finally { fake.restore(); }
  }
  // under-payment: payment recorded, but NOT reactivated
  let calls = await run(100);
  check('recordPaymentAndReactivate: payment recorded', calls.some((s) => s.includes('INSERT INTO payments')));
  check('created-EXPIRED not reactivated when amount < package price', !calls.some((s) => s.includes("SET status='ACTIVE'")));
  // full package price: reactivated
  calls = await run(500);
  check('created-EXPIRED reactivated when amount >= package price', calls.some((s) => s.includes("SET status='ACTIVE'")));
}

/* ---------- created-EXPIRED cannot be reactivated raw ---------- */
async function createdSourcePreservedTest() {
  // suspension_source='CREATION' must survive provisioning so the payment gate keeps working
  settings.invalidateCache();
  const fake = makeDb([
    ...settingsHandlers,
    { when: (c) => has(c, 'SELECT * FROM subscribers WHERE id=$1'), return: { rows: [CREATED_EXPIRED_SUB] } },
    { when: (c) => has(c, 'FROM subscribers s LEFT JOIN bandwidth_packages bp'), return: { rows: [CREATED_EXPIRED_SUB] } },
  ]);
  try {
    await billing.applyProvisioningState('sub-ce', { status: 'EXPIRED', stage: 'ISOLATED', walled_garden: false, reason: 'x' });
    check('applyProvisioningState does not clear suspension_source=CREATION',
      !fake.calls.some((c) => /suspension_source\s*=/.test(c.sql)));
  } finally { fake.restore(); }
}

(async () => {
  await computeNewExpiryTest();
  await invoicingExclusionTest();
  await activateCreatedExpiredTest();
  await noFreeActivationTest();
  await recordPaymentGateTest();
  await createdSourcePreservedTest();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
