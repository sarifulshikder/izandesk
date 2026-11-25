'use strict';
/* Regression & integration tests for platform upgrades:
 * - Secret store versioned AES-256-GCM envelope & key rotation
 * - Zod validation middleware
 * - Versioned SQL migrator (advisory locks, checksums, transactional apply)
 * - Database-backed staff users & /api/staff RBAC guards
 * - Encrypted router/OLT credentials on write & sanitized API responses
 * - Native net-snmp OLT test & IF-MIB discovery without CLI/docker exec
 * - Nodemailer simulated/email provider dispatch
 * - Telemetry history recording & bucketed queries
 * - Extended Prometheus /api/metrics gauges & counters
 * Run: node tests/platform-upgrades.test.cjs (requires: pnpm --filter api build first) */
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const db = require('../dist/db/index.js');
const { loadMigrationFiles, runMigrations } = require('../dist/db/migrator.js');
const secretStore = require('../dist/security/secret-store.js');
const { parseWithSchema, validateBody } = require('../dist/http/validate.js');
const { createRateLimiter } = require('../dist/security/rate-limit.js');
const { sendViaProvider } = require('../dist/integrations/messaging.js');
const telemetryHistory = require('../dist/integrations/telemetry-history.js');
const { rotateStoredSecrets } = require('../dist/integrations/secret-migration.js');
const { recordHttpMetric, recordPollMetric, adjustStreamClients } = require('../dist/infra/metrics.js');
const { registerProbeRoutes } = require('../dist/routes/probes.js');
const staffRouter = require('../dist/routes/staff.js').default;
const networkRouter = require('../dist/routes/network.js').default;
const oltRouter = require('../dist/routes/olt.js').default;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
}
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
  db.pool.connect = async () => ({
    query: runner,
    release: () => {},
  });
  return {
    calls,
    restore: () => {
      db.pool.query = originalQuery;
      db.pool.connect = originalConnect;
    },
  };
}

async function testSecretStoreAndRotation() {
  const k1 = crypto.randomBytes(32).toString('base64');
  const k2 = crypto.randomBytes(32).toString('base64');
  const prevKeys = process.env.SECRETS_ENCRYPTION_KEYS;
  const prevActive = process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID;
  try {
    process.env.SECRETS_ENCRYPTION_KEYS = `v1:${k1},v2:${k2}`;
    process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const enc1 = secretStore.encryptSecret('mikrotik-pass-1');
    check('secret-store: envelope carries active key id v1', enc1.startsWith('enc:v1:'));
    check('secret-store: decrypts v1 ciphertext', secretStore.decryptSecret(enc1) === 'mikrotik-pass-1');

    // Rotate active key to v2 while keeping v1 in keyring
    process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID = 'v2';
    const enc2 = secretStore.encryptSecret('mikrotik-pass-2');
    check('secret-store: rotated envelope carries v2', enc2.startsWith('enc:v2:'));
    check('secret-store: still decrypts v1 after rotation', secretStore.decryptSecret(enc1) === 'mikrotik-pass-1');
    check('secret-store: decrypts v2 ciphertext', secretStore.decryptSecret(enc2) === 'mikrotik-pass-2');

    // Plaintext pass-through for legacy rows/tests
    check('secret-store: plaintext passes through decryptSecretValue', secretStore.decryptSecretValue('legacy-plain') === 'legacy-plain');
    check('secret-store: null stays null on encryptSecretValue', secretStore.encryptSecretValue(null) === null);

    const encObj = secretStore.encryptCredentialsObject({ apiKey: 'secret-123', mode: 'live' });
    check('secret-store: credentials object values encrypted', secretStore.isEncryptedSecret(encObj.apiKey));
    const decObj = secretStore.decryptCredentialsObject(encObj);
    check('secret-store: credentials object decrypted cleanly', decObj.apiKey === 'secret-123' && decObj.mode === 'live');
  } finally {
    if (prevKeys === undefined) delete process.env.SECRETS_ENCRYPTION_KEYS; else process.env.SECRETS_ENCRYPTION_KEYS = prevKeys;
    if (prevActive === undefined) delete process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID; else process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID = prevActive;
  }
}

async function testStoredSecretRotation() {
  const k1 = crypto.randomBytes(32).toString('base64');
  const k2 = crypto.randomBytes(32).toString('base64');
  const prevKeys = process.env.SECRETS_ENCRYPTION_KEYS;
  const prevActive = process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID;
  try {
    process.env.SECRETS_ENCRYPTION_KEYS = `v1:${k1},v2:${k2}`;
    process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const oldRouterSecret = secretStore.encryptSecret('router-pass');
    const oldGatewaySecret = secretStore.encryptSecret('gateway-secret');
    process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID = 'v2';

    const fake = makeDb([
      { when: (c) => has(c, 'FROM network_routers'), return: { rows: [{ id: 'r1', password: oldRouterSecret, radius_secret: null }] } },
      { when: (c) => has(c, 'FROM olts'), return: { rows: [] } },
      { when: (c) => has(c, 'FROM payment_gateway_configs'), return: { rows: [{ gateway: 'bkash', credentials: { api_key: oldGatewaySecret }, webhook_secret: oldGatewaySecret }] } },
      { when: (c) => has(c, 'FROM messaging_channels'), return: { rows: [] } },
      { when: (c) => has(c, 'FROM settings'), return: { rows: [] } },
      { when: (c) => has(c, 'FROM user_mfa'), return: { rows: [] } },
    ]);
    try {
      const report = await rotateStoredSecrets();
      check('secret rotation: reports rotated rows and no errors', report.rotated.network_routers === 1 && report.rotated.payment_gateway_configs === 1 && report.errors.length === 0);

      const routerUpdate = fake.calls.find((c) => has(c, 'UPDATE network_routers'));
      check('secret rotation: re-encrypts router secret under active key', !!routerUpdate && String(routerUpdate.params[1]).startsWith('enc:v2:') && secretStore.decryptSecret(routerUpdate.params[1]) === 'router-pass');

      const gatewayUpdate = fake.calls.find((c) => has(c, 'UPDATE payment_gateway_configs'));
      const creds = JSON.parse(gatewayUpdate.params[1]);
      check('secret rotation: re-encrypts gateway credentials and webhook secret', creds.api_key.startsWith('enc:v2:') && secretStore.decryptSecret(creds.api_key) === 'gateway-secret' && String(gatewayUpdate.params[2]).startsWith('enc:v2:'));
    } finally {
      fake.restore();
    }
  } finally {
    if (prevKeys === undefined) delete process.env.SECRETS_ENCRYPTION_KEYS; else process.env.SECRETS_ENCRYPTION_KEYS = prevKeys;
    if (prevActive === undefined) delete process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID; else process.env.SECRETS_ENCRYPTION_ACTIVE_KEY_ID = prevActive;
  }
}

async function testZodValidation() {
  const schema = z.object({ email: z.string().email(), count: z.number().int().min(1) });
  const ok = parseWithSchema(schema, { email: 'ops@izandesk.com', count: 3 });
  check('zod: parses valid object', ok.email === 'ops@izandesk.com' && ok.count === 3);

  let caught = null;
  try {
    parseWithSchema(schema, { email: 'not-an-email', count: 0 });
  } catch (e) {
    caught = e;
  }
  check('zod: invalid input throws ValidationError (400)', caught && caught.status === 400 && /email/i.test(caught.message));

  const mw = validateBody(schema);
  let nextErr = null;
  mw({ body: { email: 'bad', count: 1 } }, {}, (e) => { nextErr = e; });
  check('zod: validateBody passes ValidationError to next()', nextErr && nextErr.status === 400);
}

async function testMigrator() {
  const files = loadMigrationFiles();
  check('migrator: discovers SQL migration files', files.length >= 3 && files[0].version === '001');

  const first = files[0];
  const fake = makeDb([
    { when: (c) => has(c, 'SELECT version, name, checksum FROM schema_migrations'), return: { rows: [{ version: first.version, name: first.name, checksum: first.checksum }] } },
    { when: (c) => has(c, 'INSERT INTO schema_migrations'), return: { rows: [] } },
  ]);
  try {
    const res = await runMigrations();
    check('migrator: skips already-applied migration and applies remaining', res.alreadyApplied === 1 && res.applied.length === files.length - 1);
    check('migrator: acquires and releases advisory lock', fake.calls.some((c) => has(c, 'pg_advisory_lock')) && fake.calls.some((c) => has(c, 'pg_advisory_unlock')));
  } finally {
    fake.restore();
  }
}

async function testStaffRbac() {
  const runStaff = async (role, method, path, body, handlers) => {
    const fake = makeDb(handlers);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'usr-admin-01', name: 'Admin', email: 'admin@izandesk.com', role }; next(); });
    app.use('/api/staff', staffRouter);
    app.use((err, _req, res, _next) => { res.status(err.status || 500).json({ message: err.message }); });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json().catch(() => ({})), calls: fake.calls };
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      fake.restore();
    }
  };

  const denied = await runStaff('NOC_ENGINEER', 'GET', '/api/staff', null, []);
  check('staff: non-admin denied with 403', denied.status === 403);

  const selfDemote = await runStaff('SUPER_ADMIN', 'PUT', '/api/staff/usr-admin-01', { role: 'TECHNICIAN' }, [
    { when: (c) => has(c, 'SELECT id, role, is_active FROM staff_users WHERE id=$1'), return: { rows: [{ id: 'usr-admin-01', role: 'SUPER_ADMIN', is_active: true }] } },
  ]);
  check('staff: self-demotion blocked with 400', selfDemote.status === 400);

  const created = await runStaff('SUPER_ADMIN', 'POST', '/api/staff', {
    name: 'Nadia NOC',
    email: 'nadia@izandesk.com',
    password: 'StrongPassword1',
    role: 'NOC_ENGINEER',
  }, [
    { when: (c) => has(c, 'SELECT key, value FROM settings'), return: { rows: [] } },
    { when: (c) => has(c, 'INSERT INTO settings'), return: { rows: [] } },
    { when: (c) => has(c, 'INSERT INTO staff_users('), return: { rows: [{ id: 'usr-new', name: 'Nadia NOC', email: 'nadia@izandesk.com', role: 'NOC_ENGINEER', is_active: true }] } },
    { when: (c) => has(c, 'INSERT INTO audit_logs'), return: { rows: [] } },
  ]);
  check('staff: SUPER_ADMIN can create operator', created.status === 201 && created.body.data?.email === 'nadia@izandesk.com');
}

async function testRouterAndOltEncryption() {
  const fake = makeDb([
    {
      when: (c) => has(c, 'INSERT INTO network_routers('),
      return: (c) => ({ rows: [{ id: 'r-enc', name: c.params[0], host: c.params[1], password: c.params[5], integration_mode: c.params[13], radius_secret: c.params[14] }] }),
    },
    {
      when: (c) => has(c, 'INSERT INTO olts('),
      return: (c) => ({ rows: [{ id: 'o-enc', name: c.params[0], host: c.params[3], password: c.params[7], snmp_community: c.params[8] }] }),
    },
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1', role: 'SUPER_ADMIN' }; next(); });
  app.use('/api/network', networkRouter);
  app.use('/api/olt', oltRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const { port } = server.address();
    const rRes = await fetch(`http://127.0.0.1:${port}/api/network/routers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Core1', host: '10.0.0.1', integration_mode: 'RADIUS', radius_secret: 'rad-sec-1', password: 'ros-pw-1' }),
    });
    const rBody = await rRes.json();
    const rInsert = fake.calls.find((c) => has(c, 'INSERT INTO network_routers('));
    check('router: password & radius_secret encrypted before DB insert', secretStore.isEncryptedSecret(rInsert?.params[5]) && secretStore.isEncryptedSecret(rInsert?.params[14]));
    check('router: API response strips secrets and exposes presence flags', rRes.status === 201 && !rBody.password && !rBody.radius_secret && rBody.has_password === true && rBody.has_radius_secret === true);

    const oRes = await fetch(`http://127.0.0.1:${port}/api/olt/olts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'OLT1', host: '10.5.0.100', vendor: 'VSOL', password: 'olt-pw-1', snmp_community: 'private123' }),
    });
    const oBody = await oRes.json();
    const oInsert = fake.calls.find((c) => has(c, 'INSERT INTO olts('));
    check('olt: password & snmp_community encrypted before DB insert', secretStore.isEncryptedSecret(oInsert?.params[7]) && secretStore.isEncryptedSecret(oInsert?.params[8]));
    check('olt: API response strips secrets and exposes presence flags', oRes.status === 201 && !oBody.password && !oBody.snmp_community && oBody.has_password === true && oBody.has_snmp_community === true);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fake.restore();
  }
}

async function testNativeNetSnmpOlt() {
  const snmpPath = require.resolve('net-snmp');
  const origSnmp = require.cache[snmpPath];
  let createdOpts = null;
  require.cache[snmpPath] = {
    id: snmpPath,
    filename: snmpPath,
    loaded: true,
    exports: {
      Version2c: 1,
      isVarbindError: () => false,
      createSession: (_host, community, opts) => {
        createdOpts = { community, opts };
        return {
          get: (_oids, cb) => {
            cb(null, [
              { oid: '1.3.6.1.2.1.1.1.0', value: Buffer.from('VSOL V1600D') },
              { oid: '1.3.6.1.2.1.1.5.0', value: Buffer.from('OLT-DHAKA-1') },
              { oid: '1.3.6.1.2.1.1.3.0', value: 123456 },
            ]);
          },
          subtree: (oid, _maxRep, feed, done) => {
            if (oid === '1.3.6.1.2.1.31.1.1.1.1') {
              feed([{ oid: '1.3.6.1.2.1.31.1.1.1.1.15', value: Buffer.from('EPON01ONU1 TestUser') }]);
            } else if (oid === '1.3.6.1.2.1.2.2.1.8') {
              feed([{ oid: '1.3.6.1.2.1.2.2.1.8.15', value: 1 }]);
            }
            done(null);
          },
          close: () => {},
        };
      },
    },
  };
  delete require.cache[require.resolve('../dist/integrations/olt.js')];
  const olt = require('../dist/integrations/olt.js');
  try {
    const encComm = secretStore.encryptSecretValue('corp-snmp');
    const t = await olt.oltTest({ host: '10.5.0.100', snmp_port: 1161, snmp_community: encComm });
    check('net-snmp: oltTest decrypts community, uses snmp_port & succeeds', t.ok === true && t.sysName === 'OLT-DHAKA-1' && createdOpts.community === 'corp-snmp' && createdOpts.opts.port === 1161);

    const disc = await olt.oltDiscoverOnus({ host: '10.5.0.100', vendor: 'VSOL', snmp_community: encComm });
    check('net-snmp: oltDiscoverOnus parses IF-MIB EPON ONU natively', disc.ok === true && disc.mode === 'snmp' && disc.onus.length === 1 && disc.onus[0].pon_port === 'EPON0/1' && disc.onus[0].status === 'ONLINE');
  } finally {
    if (origSnmp) require.cache[snmpPath] = origSnmp; else delete require.cache[snmpPath];
    delete require.cache[require.resolve('../dist/integrations/olt.js')];
  }
}

async function testEmailTelemetryAndMetrics() {
  const fake = makeDb([
    { when: (c) => has(c, 'SELECT key, value FROM settings'), return: { rows: [] } },
    { when: (c) => has(c, 'INSERT INTO settings'), return: { rows: [] } },
    { when: (c) => has(c, 'INSERT INTO router_telemetry_history'), return: { rows: [] } },
    { when: (c) => has(c, 'FROM router_telemetry_history'), return: { rows: [{ ts: new Date().toISOString(), cpu_load: 18.5, rx_bps: 1000000, tx_bps: 500000 }] } },
  ]);
  try {
    const emailRes = await sendViaProvider({ channel_type: 'EMAIL', provider: 'SMTP', config: {}, credentials: {} }, { to: 'cust@example.com', subject: 'Test', body: 'Hello' });
    check('email: SMTP provider simulates cleanly when SMTP host is blank', emailRes.ok === true && emailRes.status === 'SIMULATED');

    await telemetryHistory.recordRouterTelemetrySample({ router_id: 'r1', status: 'ONLINE', cpu_load: 18.5, rx_bps: 1000000, tx_bps: 500000, active_sessions: 12 });
    const hist = await telemetryHistory.getRouterTelemetryHistory('r1', 24);
    check('telemetry: records & queries router telemetry history', fake.calls.some((c) => has(c, 'INSERT INTO router_telemetry_history')) && hist.length === 1);
  } finally {
    fake.restore();
  }

  const rl = createRateLimiter('test', 2, 60_000);
  check('rate-limit: allows within limit and blocks 3rd hit', (await rl.checkDistributed('k1')).allowed && (await rl.checkDistributed('k1')).allowed && !(await rl.checkDistributed('k1')).allowed);

  recordHttpMetric('GET', '/api/test', 200, 0.042);
  recordPollMetric('olt', true, 120);
  adjustStreamClients('ws', 1);
  const app = express();
  registerProbeRoutes(app, { getDbReady: () => true, probeDbReady: async () => true, getKernel: () => ({ isReady: () => true, listPlugins: () => [] }), lite: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/metrics`);
    const text = await res.text();
    check('metrics: exposes HTTP requests, poll counters, and stream gauges', text.includes('izandesk_http_requests_total') && text.includes('izandesk_network_polls_total') && text.includes('izandesk_active_stream_clients{transport="ws"} 1'));
  } finally {
    adjustStreamClients('ws', -1);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  await testSecretStoreAndRotation();
  await testStoredSecretRotation();
  await testZodValidation();
  await testMigrator();
  await testStaffRbac();
  await testRouterAndOltEncryption();
  await testNativeNetSnmpOlt();
  await testEmailTelemetryAndMetrics();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
