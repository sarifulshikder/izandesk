'use strict';
/* Regression tests for the billing fixes: advance-credit application,
 * invoice-number collision retry, payment idempotency, overpayment crediting,
 * manual-suspension preservation, and SMS-to-checkout binding.
 * Run: node tests/billing-regressions.test.cjs (requires: pnpm --filter api build first) */
const billing = require('../dist/integrations/billing.js');
const settings = require('../dist/integrations/settings.js');
const db = require('../dist/db/index.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
}
const has = (call, fragment) => call.sql.includes(fragment);
const duplicateError = () => Object.assign(new Error('duplicate key value'), { code: '23505' });

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

const settingsHandlers = [
  { when: (c) => has(c, 'SELECT key, value FROM settings'), return: { rows: [] } },
  { when: (c) => has(c, 'INSERT INTO settings'), return: { rows: [] } },
];

async function invoiceCreditTest() {
  settings.invalidateCache();
  let count = 0;
  const fake = makeDb([
    ...settingsHandlers,
    { when: (c) => has(c, 'SELECT id, invoice_number FROM invoices WHERE subscriber_id'), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT COUNT(*)::int as c FROM invoices WHERE invoice_number LIKE'), return: () => ({ rows: [{ c: count++ }] }) },
    { when: (c) => has(c, 'SELECT COALESCE(excess_amount,0)::numeric AS excess FROM subscribers'), return: { rows: [{ excess: 30 }] } },
    { when: (c) => has(c, 'UPDATE subscribers SET excess_amount=COALESCE(excess_amount,0)-'), return: { rows: [] } },
    { when: (c) => has(c, 'INSERT INTO invoices ('), return: { rows: [{ id: 'inv-credit', invoice_number: 'INV-CREDIT' }] } },
    { when: (c) => has(c, 'INSERT INTO invoice_items'), return: { rows: [] } },
    { when: (c) => has(c, 'UPDATE subscribers SET last_billed_at'), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT COALESCE(SUM(GREATEST(due_amount,0))'), return: { rows: [{ due: 70 }] } },
    { when: (c) => has(c, 'UPDATE subscribers SET current_due'), return: { rows: [] } },
  ]);
  try {
    const result = await billing.generateInvoiceForSubscriber({
      id: 's1', client_code: 'C1', full_name: 'Test Subscriber', monthly_bill: 100,
    }, { cycleDate: new Date('2026-11-01T00:00:00Z') });
    const insert = fake.calls.find((c) => has(c, 'INSERT INTO invoices ('));
    const consume = fake.calls.find((c) => has(c, 'UPDATE subscribers SET excess_amount=COALESCE(excess_amount,0)-'));
    check('invoice: generation succeeded with advance credit', result.ok === true);
    check('invoice: advance credit applied as discount', Number(insert?.params[11]) === 30);
    check('invoice: due reduced by advance credit', Number(insert?.params[13]) === 70);
    check('invoice: status remains UNPAID when credit is partial', insert?.params[14] === 'UNPAID');
    check('invoice: advance credit consumed from subscriber', Number(consume?.params[1]) === 30);
  } finally {
    fake.restore();
  }
}

async function invoiceRetryTest() {
  settings.invalidateCache();
  let count = 0;
  let attempts = 0;
  const numbers = [];
  const fake = makeDb([
    ...settingsHandlers,
    { when: (c) => has(c, 'SELECT id, invoice_number FROM invoices WHERE subscriber_id'), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT COUNT(*)::int as c FROM invoices WHERE invoice_number LIKE'), return: () => ({ rows: [{ c: count++ }] }) },
    {
      when: (c) => has(c, 'INSERT INTO invoices ('),
      return: (c) => {
        attempts++;
        numbers.push(c.params[0]);
        if (attempts === 1) return { throw: duplicateError() };
        return { rows: [{ id: 'inv-retry', invoice_number: c.params[0] }] };
      },
    },
    { when: (c) => has(c, 'INSERT INTO invoice_items'), return: { rows: [] } },
    { when: (c) => has(c, 'UPDATE subscribers SET last_billed_at'), return: { rows: [] } },
  ]);
  try {
    const result = await billing.generateInvoiceForSubscriber({
      id: 's2', client_code: 'C2', full_name: 'Retry Subscriber', monthly_bill: 100,
    }, { cycleDate: new Date('2026-11-01T00:00:00Z') });
    check('invoice: collision retry eventually succeeds', result.ok === true);
    check('invoice: collision produced two insert attempts', attempts === 2);
    check('invoice: retry used a fresh number', numbers.length === 2 && numbers[0] !== numbers[1]);
  } finally {
    fake.restore();
  }
}

async function duplicatePaymentTest() {
  const existing = { id: 'p1', payment_ref: 'PAY-1', invoice_id: 'i1', subscriber_id: 's1', status: 'COMPLETED', amount: 100 };
  const fake = makeDb([
    { when: (c) => has(c, "SELECT * FROM payments WHERE gateway=$1 AND trx_id=$2 AND status='COMPLETED'"), return: { rows: [existing] } },
    { when: (c) => has(c, 'SELECT * FROM invoices WHERE id=$1'), return: { rows: [{ id: 'i1' }] } },
  ]);
  try {
    const result = await billing.recordPaymentAndReactivate({
      gateway: 'bkash', amount: 100, trx_id: 'TRX-DUP', invoice_id: 'i1',
    });
    check('payment: duplicate transaction detected', result.duplicate === true && result.ok === true);
    check('payment: duplicate returns existing row', result.payment?.id === 'p1');
    check('payment: duplicate applies no mutation', !fake.calls.some((c) =>
      has(c, 'INSERT INTO payments') || has(c, 'UPDATE invoices') ||
      has(c, 'UPDATE subscribers') || has(c, 'INSERT INTO wallet_transactions')));
  } finally {
    fake.restore();
  }
}

async function overpaymentTest() {
  const fake = makeDb([
    { when: (c) => has(c, 'SELECT * FROM invoices WHERE id=$1'), return: { rows: [{ id: 'i2', subscriber_id: 's3', total_amount: 100, paid_amount: 20, due_amount: 50, status: 'PARTIAL' }] } },
    { when: (c) => has(c, 'INSERT INTO payments'), return: { rows: [{ id: 'p2', payment_ref: 'PAY-2', invoice_id: 'i2', subscriber_id: 's3', status: 'COMPLETED' }] } },
    { when: (c) => has(c, 'UPDATE invoices SET paid_amount'), return: { rows: [{ id: 'i2', paid_amount: 70, due_amount: 0, status: 'PAID' }] } },
    { when: (c) => has(c, 'UPDATE subscribers SET excess_amount=COALESCE(excess_amount,0)+$2'), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT COALESCE(SUM(GREATEST(due_amount,0))'), return: { rows: [{ due: 0 }] } },
    { when: (c) => has(c, 'UPDATE subscribers SET current_due'), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT status, suspension_stage, walled_garden FROM subscribers'), return: { rows: [{ status: 'ACTIVE', suspension_stage: 'NONE', walled_garden: false }] } },
  ]);
  try {
    const result = await billing.recordPaymentAndReactivate({
      gateway: 'bkash', amount: 100, invoice_id: 'i2', trx_id: 'TRX-OVER', status: 'COMPLETED',
    });
    const invoiceUpdate = fake.calls.find((c) => has(c, 'UPDATE invoices SET paid_amount'));
    const creditUpdate = fake.calls.find((c) => has(c, 'UPDATE subscribers SET excess_amount=COALESCE(excess_amount,0)+$2'));
    check('payment: overpayment result is not a duplicate', result.ok === true && result.duplicate === false);
    check('payment: authoritative due_amount capped invoice payment', Number(invoiceUpdate?.params[1]) === 70 && Number(invoiceUpdate?.params[2]) === 0);
    check('payment: excess amount credited to subscriber', Number(creditUpdate?.params[1]) === 50);
    check('payment: waiver not recreated as due', Number(invoiceUpdate?.params[2]) === 0);
  } finally {
    fake.restore();
  }
}

async function manualSuspensionTest() {
  const fake = makeDb([
    { when: (c) => has(c, 'SELECT suspension_source, suspension_reason FROM subscribers'), return: { rows: [{ suspension_source: 'MANUAL', suspension_reason: 'Manual suspension' }] } },
  ]);
  try {
    const result = await billing.reactivateSubscriber('s4');
    check('reactivation: manual suspension preserved', result.ok === true && result.skipped === true);
    check('reactivation: manual suspension causes no provisioning', !fake.calls.some((c) =>
      has(c, 'UPDATE subscribers SET status') || has(c, 'INSERT INTO billing_suspension_logs')));
  } finally {
    fake.restore();
  }
}

async function smsBindingTests() {
  const eventRow = { id: 'sms-1' };
  const noTrx = makeDb([
    { when: (c) => has(c, 'INSERT INTO payment_sms_events'), return: { rows: [eventRow] } },
    { when: (c) => has(c, 'UPDATE payment_sms_events SET status'), return: { rows: [eventRow] } },
  ]);
  try {
    const result = await billing.ingestMfsSmsEvent({ gateway: 'bkash', message: 'paid 100.00' });
    check('sms: amount-only event is not auto-matched', result.recorded == null && /transaction id/i.test(String(result.reason || '')));
    check('sms: amount-only event records no payment', !noTrx.calls.some((c) => has(c, 'INSERT INTO payments')));
  } finally {
    noTrx.restore();
  }

  const tooMuch = makeDb([
    { when: (c) => has(c, 'INSERT INTO payment_sms_events'), return: (c) => ({ rows: [{ ...eventRow, amount: c.params[4] }] }) },
    { when: (c) => has(c, 'SELECT * FROM payments WHERE gateway=$1 AND trx_id=$2 ORDER BY'), return: { rows: [{ status: 'PENDING', payment_ref: 'PAY-3', amount: 50, subscriber_id: 's5' }] } },
    { when: (c) => has(c, 'UPDATE payment_sms_events SET status'), return: { rows: [eventRow] } },
  ]);
  try {
    const result = await billing.ingestMfsSmsEvent({ gateway: 'bkash', trx_id: 'TRX-SMS', amount: 80 });
    check('sms: amount above pending checkout rejected', result.recorded == null && /does not match/i.test(String(result.reason || '')));
    check('sms: over-amount event records no payment', !tooMuch.calls.some((c) => has(c, 'INSERT INTO payments')));
  } finally {
    tooMuch.restore();
  }

  const withinAmount = makeDb([
    { when: (c) => has(c, 'INSERT INTO payment_sms_events'), return: (c) => ({ rows: [{ ...eventRow, amount: c.params[4] }] }) },
    { when: (c) => has(c, 'SELECT * FROM payments WHERE gateway=$1 AND trx_id=$2 ORDER BY'), return: { rows: [{ status: 'PENDING', payment_ref: 'PAY-4', amount: 50, subscriber_id: 's6' }] } },
    { when: (c) => has(c, 'INSERT INTO payments'), return: { rows: [{ id: 'p4', payment_ref: 'PAY-4', status: 'COMPLETED' }] } },
    { when: (c) => has(c, 'SELECT COALESCE(SUM(GREATEST(due_amount,0))'), return: { rows: [{ due: 0 }] } },
    { when: (c) => has(c, 'UPDATE subscribers SET current_due'), return: { rows: [] } },
    { when: (c) => has(c, 'UPDATE payment_sms_events SET status'), return: { rows: [eventRow] } },
  ]);
  try {
    const result = await billing.ingestMfsSmsEvent({ gateway: 'bkash', trx_id: 'TRX-SMS-OK', amount: 50 });
    const insert = withinAmount.calls.find((c) => has(c, 'INSERT INTO payments'));
    check('sms: matched event records a payment', result.recorded?.ok === true);
    check('sms: payment capped at pending checkout amount', Number(insert?.params[5]) === 50);
  } finally {
    withinAmount.restore();
  }
}

(async () => {
  await invoiceCreditTest();
  await invoiceRetryTest();
  await duplicatePaymentTest();
  await overpaymentTest();
  await manualSuspensionTest();
  await smsBindingTests();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
