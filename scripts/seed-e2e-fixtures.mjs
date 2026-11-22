/**
 * Idempotently seed the minimal fixtures the Playwright smoke suite assumes.
 * Intended for disposable dev/CI stacks only — never run against production.
 */
const API = process.env.API_URL || process.env.E2E_API_URL || 'http://localhost:4000';
const admin = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@izandesk.com',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
};
const resellerEmail = process.env.E2E_RESELLER_EMAIL || 'reseller@cybernet.bd';

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const adminToken = (await api('/api/auth/login', {
  method: 'POST',
  body: { email: admin.email, password: admin.password },
})).token;
if (!adminToken) throw new Error('Admin login did not return a token');

const partners = (await api('/api/resellers', { token: adminToken })).data || [];
const partner = partners.find((r) => r.email === resellerEmail);
if (!partner?.id) throw new Error(`Could not resolve reseller ${resellerEmail}`);

const owned = (await api('/api/subscribers?limit=200', { token: adminToken })).data || [];
const existing = owned.find((s) => s.reseller_id === partner.id);
if (existing) {
  console.log(`E2E fixture already present: ${existing.id}`);
  process.exit(0);
}

const created = await api('/api/subscribers', {
  method: 'POST',
  token: adminToken,
  body: {
    client_code: 'E2E-OWNED-001',
    full_name: 'E2E Owned Subscriber',
    subscriber_type: 'HOME',
    connection_type: 'PPPOE',
    status: 'ACTIVE',
    username: 'e2e-owned-subscriber',
    phone: '+8801700009999',
    email: 'e2e-owned@example.com',
    package_name: 'E2E Test Package',
    monthly_bill: 500,
    reseller_id: partner.id,
    latitude: 22.75,
    longitude: 89.5,
    address: 'E2E fixture address',
    notes: 'Seeded by scripts/seed-e2e-fixtures.mjs for disposable smoke stacks.',
  },
});
console.log(`Created E2E owned subscriber: ${created.data?.id || created.id}`);
