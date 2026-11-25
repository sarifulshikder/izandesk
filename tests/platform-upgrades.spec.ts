import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const admin = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@izandesk.com',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
};

const reseller = {
  email: process.env.E2E_RESELLER_EMAIL || 'reseller@cybernet.bd',
  password: process.env.E2E_RESELLER_PASSWORD || 'reseller123',
};

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-username')).toBeVisible();
  await page.locator('#login-username').fill(admin.email);
  await page.locator('#login-password').fill(admin.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('#login-username')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function apiLogin(request: APIRequestContext, creds: { email: string; password: string }) {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

test('settings Staff & Access tab renders DB-backed staff directory', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  const staffTab = page.getByRole('button', { name: /Staff & Access/ });
  await expect(staffTab).toBeVisible();
  await staffTab.click();
  const panel = page.getByTestId('staff-admin');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Staff & RBAC Directory')).toBeVisible();
  await expect(panel.getByText('admin@izandesk.com')).toBeVisible();
  await expect(panel.getByText('noc@izandesk.com')).toBeVisible();
});

test('system health shows BullMQ queues and applied SQL migrations', async ({ page }) => {
  await login(page);
  await page.goto('/system/health');
  await expect(page.getByText('BullMQ Job Queues')).toBeVisible();
  await expect(page.getByText('Database Migrations')).toBeVisible();
  await expect(page.getByText('001_staff_users_and_security.sql')).toBeVisible();
  await expect(page.getByText('002_telemetry_history.sql')).toBeVisible();
  await expect(page.getByText('003_observability_and_email.sql')).toBeVisible();
});

test('staff, queues and migrations endpoints enforce RBAC', async ({ request }) => {
  const resellerToken = await apiLogin(request, reseller);
  const rh = { Authorization: `Bearer ${resellerToken}` };
  expect((await request.get('/api/staff', { headers: rh })).status()).toBe(403);
  expect((await request.get('/api/system/queues', { headers: rh })).status()).toBe(403);
  expect((await request.get('/api/system/migrations', { headers: rh })).status()).toBe(403);

  const adminToken = await apiLogin(request, admin);
  const ah = { Authorization: `Bearer ${adminToken}` };
  const queuesRes = await request.get('/api/system/queues', { headers: ah });
  expect(queuesRes.ok()).toBeTruthy();
  const qBody = await queuesRes.json();
  expect(qBody.active).toBe(true);
  expect(qBody.redis_ready).toBe(true);
});

test('opt-in: create, login as, disable, and delete a staff operator', async ({ request }) => {
  test.skip(process.env.E2E_MUTATIONS !== '1', 'Set E2E_MUTATIONS=1 to run mutating staff lifecycle');
  const adminToken = await apiLogin(request, admin);
  const ah = { Authorization: `Bearer ${adminToken}` };
  const email = `e2e-staff-${Date.now()}@izandesk.com`;
  const password = 'E2eStaffPass1!';

  const createRes = await request.post('/api/staff', {
    headers: ah,
    data: { name: 'E2E Temp Operator', email, password, role: 'NOC_ENGINEER' },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()).data;
  expect(created?.id).toBeTruthy();

  try {
    const newToken = await apiLogin(request, { email, password });
    expect(newToken).toBeTruthy();

    const disableRes = await request.put(`/api/staff/${created.id}`, {
      headers: ah,
      data: { is_active: false },
    });
    expect(disableRes.ok()).toBeTruthy();

    const blocked = await request.post('/api/auth/login', { data: { email, password } });
    expect(blocked.status()).toBe(401);
  } finally {
    await request.delete(`/api/staff/${created.id}`, { headers: ah });
  }
});
