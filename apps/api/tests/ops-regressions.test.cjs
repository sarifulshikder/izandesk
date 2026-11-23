'use strict';
/* Regression tests for operational visibility fixes:
 * - due reminders include UNPAID invoices and render template variables
 * - failed message logs do not suppress retries
 * - report schedules are claimed atomically and report real delivery status
 * - /api/system/health fails the HTTP status when dependencies are down
 * - blank RosException errors are normalized and persisted by router tests
 * Run: node tests/ops-regressions.test.cjs (requires: pnpm --filter api build first) */
const express = require('express');
const db = require('../dist/db/index.js');
const messaging = require('../dist/integrations/messaging.js');
const reports = require('../dist/integrations/report-scheduler.js');
const mikrotikErrors = require('../dist/integrations/mikrotik-errors.js');

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
  {
    check('report: interval_minutes takes precedence over legacy cron', reports.scheduleIntervalMinutes({ interval_minutes: 15, schedule_cron: '0 8 * * *' }) === 15);
    check('report: legacy daily cron maps to 1440 minutes', reports.scheduleIntervalMinutes({ schedule_cron: '0 8 * * *' }) === 1440);
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

async function mikrotikErrorTest() {
  const blankRos = { name: 'RosException', message: '', errno: -113 };
  const msg = mikrotikErrors.mikrotikErrorMessage(blankRos, {
    host: '10.77.0.2', api_port: 8730, integration_mode: 'API',
  });
  check('mikrotik: blank RosException exposes the OS error', msg.includes('EHOSTUNREACH'));
  check('mikrotik: blank RosException includes non-secret endpoint', msg.includes('10.77.0.2:8730'));
  check('mikrotik: auth failures are not retried', !mikrotikErrors.isTransientMikrotikError({ name: 'RosException', message: 'CANTLOGIN' }));
  check('mikrotik: blank RosException is transient', mikrotikErrors.isTransientMikrotikError(blankRos));
}

async function routerTestPersistenceTest() {
  const mikrotik = require('../dist/integrations/mikrotik.js');
  const originalTest = mikrotik.mikrotikTest;
  mikrotik.mikrotikTest = async () => {
    const e = new Error('');
    e.name = 'RosException';
    e.errno = -113;
    throw e;
  };
  delete require.cache[require.resolve('../dist/routes/network.js')];
  const networkRouter = require('../dist/routes/network.js').default;
  const fake = makeDb([
    {
      when: (c) => has(c, 'SELECT * FROM network_routers WHERE id=$1'),
      return: { rows: [{ id: 'r1', name: 'RB1100AHx4', host: '10.77.0.2', api_port: 8730, integration_mode: 'API', identity: null, use_ssl: false }] },
    },
    {
      when: (c) => has(c, "UPDATE network_routers SET status='OFFLINE'"),
      return: { rows: [] },
    },
  ]);
  const app = express();
  app.use((req, _res, next) => { req.user = { role: 'SUPER_ADMIN' }; next(); });
  app.use('/api/network', networkRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/network/routers/r1/test`, { method: 'POST' });
    const body = await res.json();
    const update = fake.calls.find((c) => has(c, "UPDATE network_routers SET status='OFFLINE'"));
    check('router test: transport failure returns HTTP 502', res.status === 502);
    check('router test: response explains blank RosException', String(body.message).includes('EHOSTUNREACH') && String(body.message).includes('10.77.0.2:8730'));
    check('router test: failure persists normalized last_error', String(update?.params[1] || '').includes('EHOSTUNREACH'));
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fake.restore();
    mikrotik.mikrotikTest = originalTest;
    delete require.cache[require.resolve('../dist/routes/network.js')];
  }
}

async function probeRoutesTest() {
  const { registerProbeRoutes } = require('../dist/routes/probes.js');
  const mkKernel = (ready = true) => ({ isReady: () => ready, listPlugins: () => [{}, {}] });
  {
    const app = express();
    registerProbeRoutes(app, { getDbReady: () => true, probeDbReady: async () => true, getKernel: () => mkKernel(true), lite: false });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const { port } = server.address();
      const live = await fetch(`http://127.0.0.1:${port}/api/live`);
      const ready = await fetch(`http://127.0.0.1:${port}/api/ready`);
      const metrics = await fetch(`http://127.0.0.1:${port}/api/metrics`);
      const liveBody = await live.json();
      const readyBody = await ready.json();
      const metricsText = await metrics.text();
      check('probe: /api/live returns 200', live.status === 200 && liveBody.live === true);
      check('probe: /api/ready returns 200 when deps ready', ready.status === 200 && readyBody.ready === true);
      check('probe: /api/metrics exposes prometheus gauges', metrics.status === 200 && metricsText.includes('izandesk_up 1') && metricsText.includes('izandesk_ready 1'));
    } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  }
  {
    const app = express();
    registerProbeRoutes(app, { getDbReady: () => false, probeDbReady: async () => false, getKernel: () => mkKernel(true), lite: false });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const { port } = server.address();
      const live = await fetch(`http://127.0.0.1:${port}/api/live`);
      const ready = await fetch(`http://127.0.0.1:${port}/api/ready`);
      const metrics = await fetch(`http://127.0.0.1:${port}/api/metrics`);
      check('probe: /api/live stays 200 during DB outage', live.status === 200);
      check('probe: /api/ready returns 503 during DB outage', ready.status === 503);
      check('probe: /api/metrics reports not ready during DB outage', (await metrics.text()).includes('izandesk_ready 0'));
    } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  }
}

async function systemAlertsAndBackupRunsTest() {
  // stub redis for system router
  const redisPath = require.resolve('redis');
  const previousRedis = require.cache[redisPath];
  require.cache[redisPath] = {
    id: redisPath, filename: redisPath, loaded: true,
    exports: { createClient: () => ({ connect: async () => {}, ping: async () => 'PONG', info: async () => '', quit: async () => {}, disconnect: async () => {} }) },
  };
  delete require.cache[require.resolve('../dist/routes/system.js')];
  const systemRouter = require('../dist/routes/system.js').default;
  const alerts = [{ id: 'a1', severity: 'CRITICAL', source: 'ROUTER', title: 'Router offline', message: 'EHOSTUNREACH', acknowledged: false, created_at: new Date().toISOString() }];
  const fake = makeDb([
    { when: (c) => c.sql === 'SELECT 1', return: { rows: [{ '?column?': 1 }] } },
    { when: (c) => has(c, 'FROM noc_alerts ORDER BY created_at DESC LIMIT'), return: { rows: alerts } },
    { when: (c) => has(c, 'SELECT COUNT(*)::int AS c FROM noc_alerts WHERE acknowledged=false'), return: { rows: [{ c: 1 }] } },
    { when: (c) => has(c, 'UPDATE noc_alerts SET acknowledged=true'), return: { rows: [{ ...alerts[0], acknowledged: true }] } },
    { when: (c) => has(c, 'FROM backup_runs ORDER BY created_at DESC LIMIT'), return: { rows: [{ id: 'b1', trigger: 'manual', ok: true, file_name: 'izandesk.sql', created_at: new Date().toISOString() }] } },
  ]);
  const app = express();
  app.use((req, _res, next) => { req.user = { role: 'SUPER_ADMIN' }; next(); });
  app.use('/api/system', systemRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const { port } = server.address();
    const alertsRes = await fetch(`http://127.0.0.1:${port}/api/system/alerts`);
    const alertsBody = await alertsRes.json();
    check('system alerts: list returns alerts and unread count', alertsRes.status === 200 && alertsBody.unread === 1 && alertsBody.data[0].id === 'a1');
    const ackRes = await fetch(`http://127.0.0.1:${port}/api/system/alerts/a1/ack`, { method: 'POST' });
    check('system alerts: ack endpoint acknowledges alert', ackRes.status === 200 && (await ackRes.json()).data.acknowledged === true);
    const backupsRes = await fetch(`http://127.0.0.1:${port}/api/system/backups`);
    const backupsBody = await backupsRes.json();
    check('backups: response includes persisted run history', backupsRes.status === 200 && Array.isArray(backupsBody.runs) && backupsBody.last_run?.id === 'b1');
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fake.restore();
    if (previousRedis) require.cache[redisPath] = previousRedis; else delete require.cache[redisPath];
    delete require.cache[require.resolve('../dist/routes/system.js')];
  }
}

(async () => {
  await dueReminderTest();
  await reportScheduleTest();
  await systemHealthTest();
  await mikrotikErrorTest();
  await routerTestPersistenceTest();
  await probeRoutesTest();
  await systemAlertsAndBackupRunsTest();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
