'use strict';
/* Regression tests for operational visibility fixes:
 * - due reminders include UNPAID invoices and render template variables
 * - failed message logs do not suppress retries
 * - report schedules are claimed atomically and report real delivery status
 * - /api/system/health fails the HTTP status when dependencies are down
 * Run: node tests/ops-regressions.test.cjs (requires: pnpm --filter api build first) */
const express = require('express');
const db = require('../dist/db/index.js');
const messaging = require('../dist/integrations/messaging.js');
const reports = require('../dist/integrations/report-scheduler.js');

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

async function dueReminderTest() {
  const fake = makeDb([
    { when: (c) => has(c, 'FROM messaging_channels WHERE enabled=true'), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT * FROM billing_policies'), return: { rows: [{ warning_days: 3 }] } },
    { when: (c) => has(c, 'FROM invoices i JOIN subscribers s'), return: { rows: [{ invoice_id: 'inv-1', invoice_number: 'INV-1001', due_amount: 750, due_date: '2026-11-25', subscriber_id: 's1', full_name: 'Test Subscriber', phone: '+8801700000001' }] } },
    { when: (c) => has(c, "related_type='INVOICE_DUE_REMINDER'"), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT * FROM messaging_channels WHERE channel_type=$1'), return: { rows: [{ id: 'ch1', channel_type: 'SMS', provider: 'GREENWEB', enabled: true, config: {}, credentials: {} }] } },
    { when: (c) => has(c, 'SELECT * FROM message_templates WHERE name=$1'), return: { rows: [{ body: 'Dear {{name}}, your invoice {{invoice_no}} amount {{amount}} is due on {{due_date}}. - {{brand}}' }] } },
    { when: (c) => has(c, 'INSERT INTO message_logs'), return: { rows: [{ id: 'log-1' }] } },
  ]);
  try {
    await messaging.runMessagingSchedulerSweep();
    const invoiceSql = fake.calls.find((c) => has(c, 'FROM invoices i JOIN subscribers s'))?.sql || '';
    const dedupeSql = fake.calls.find((c) => has(c, "related_type='INVOICE_DUE_REMINDER'"))?.sql || '';
    const log = fake.calls.find((c) => has(c, 'INSERT INTO message_logs'));
    const body = String(log?.params[6] || '');
    check('reminder: UNPAID invoices are included', invoiceSql.includes("'UNPAID','PARTIAL','OVERDUE'"));
    check('reminder: overdue invoices are not excluded by a lower date bound', !invoiceSql.includes('i.due_date >= CURRENT_DATE'));
    check('reminder: failed logs do not count as sent', dedupeSql.includes("status IN ('SENT','SIMULATED')"));
    check('reminder: template variables render with real values', body.includes('INV-1001') && body.includes('750') && body.includes('IzanDesk') && !body.includes('{{'));
  } finally {
    fake.restore();
  }
}

function scheduleRow(recipients) {
  return [{ id: 'sch-1', name: 'Daily collections', report_key: 'collections', recipients, schedule_cron: '0 8 * * *', last_run_at: null, enabled: true }];
}

function reportHandlers(recipients, opts = {}) {
  return [
    { when: (c) => has(c, 'SELECT * FROM report_schedules WHERE enabled=true'), return: { rows: scheduleRow(recipients) } },
    { when: (c) => has(c, "last_status='RUNNING'"), return: { rowCount: 1 } },
    { when: (c) => has(c, "FROM payments WHERE status='COMPLETED'"), return: { rows: [] } },
    { when: (c) => has(c, 'SELECT * FROM messaging_channels WHERE channel_type=$1'), return: { rows: [{ id: 'ch1', channel_type: 'SMS', provider: 'GREENWEB', enabled: true, config: {}, credentials: {} }] } },
    { when: (c) => has(c, 'INSERT INTO message_logs'), return: opts.failDelivery ? { throw: new Error('delivery down') } : { rows: [{ id: 'log-1' }] } },
    { when: (c) => has(c, 'UPDATE report_schedules SET last_status=$2'), return: { rows: [] } },
  ];
}

async function reportScheduleTest() {
  {
    const fake = makeDb(reportHandlers([{ channel_type: 'SMS', provider: 'GREENWEB', to: '+8801700000001' }]));
    try {
      const result = await reports.runReportSchedulesOnce();
      const claim = fake.calls.find((c) => has(c, "last_status='RUNNING'"));
      const final = fake.calls.find((c) => has(c, 'UPDATE report_schedules SET last_status=$2'));
      check('report: schedule claimed atomically before work', !!claim && claim.sql.includes('last_run_at < $2'));
      check('report: successful delivery recorded as OK', final?.params[1] === 'OK');
      check('report: delivery counted', result.delivered === 1 && result.failed === 0);
    } finally { fake.restore(); }
  }
  {
    const fake = makeDb(reportHandlers([{ channel_type: 'SMS', provider: 'GREENWEB', to: '+8801700000001' }], { failDelivery: true }));
    try {
      const result = await reports.runReportSchedulesOnce();
      const final = fake.calls.find((c) => has(c, 'UPDATE report_schedules SET last_status=$2'));
      check('report: delivery failure is not recorded as OK', String(final?.params[1]).startsWith('PARTIAL:'));
      check('report: delivery failure counted', result.failed === 1);
    } finally { fake.restore(); }
  }
  {
    const fake = makeDb(reportHandlers([]));
    try {
      await reports.runReportSchedulesOnce();
      const final = fake.calls.find((c) => has(c, 'UPDATE report_schedules SET last_status=$2'));
      check('report: recipient-less schedule is honest about delivery', final?.params[1] === 'NO_RECIPIENTS');
    } finally { fake.restore(); }
  }
}

async function systemHealthTest() {
  // Stub redis so this test never depends on a running Redis server.
  const redisPath = require.resolve('redis');
  const previous = require.cache[redisPath];
  require.cache[redisPath] = {
    id: redisPath, filename: redisPath, loaded: true,
    exports: { createClient: () => ({ connect: async () => {}, ping: async () => 'PONG', info: async () => '', quit: async () => {}, disconnect: async () => {} }) },
  };
  delete require.cache[require.resolve('../dist/routes/system.js')];
  const systemRouter = require('../dist/routes/system.js').default;
  const fake = makeDb([
    { when: (c) => c.sql === 'SELECT 1', return: { throw: new Error('db down') } },
  ]);
  const app = express();
  app.use('/api/system', systemRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/system/health`);
    const body = await res.json();
    check('system health: dependency failure returns HTTP 503', res.status === 503);
    check('system health: dependency failure reports ok=false', body.ok === false && body.checks?.db?.ok === false);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fake.restore();
    if (previous) require.cache[redisPath] = previous; else delete require.cache[redisPath];
  }
}

(async () => {
  await dueReminderTest();
  await reportScheduleTest();
  await systemHealthTest();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
