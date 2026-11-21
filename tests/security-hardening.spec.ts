import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const admin = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@izandesk.com',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
};

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-username')).toBeVisible();
  await page.locator('#login-username').fill(admin.email);
  await page.locator('#login-password').fill(admin.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('#login-username')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(500);
}

async function loginToken(request: APIRequestContext) {
  const res = await request.post('/api/auth/login', { data: admin });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return { token: body.token as string, mfaRequired: !!body.mfa_required };
}

test('security settings expose MFA and revocable sessions', async ({ page, request }) => {
  await login(page);
  await page.goto('/settings');
  const tab = page.getByRole('button', { name: /Security/ }).first();
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.getByTestId('security-admin')).toBeVisible();
  await expect(page.getByText('Multi-factor authentication')).toBeVisible();
  await expect(page.getByText('Active sessions', { exact: true })).toBeVisible();

  const { token, mfaRequired } = await loginToken(request);
  test.skip(mfaRequired, 'MFA is enforced; password-only login is not available');
  const status = await request.get('/api/auth/mfa/status', { headers: { Authorization: `Bearer ${token}` } });
  expect(status.ok()).toBeTruthy();
  const body = await status.json();
  expect(typeof body.enabled).toBe('boolean');
  expect(typeof body.required).toBe('boolean');
  expect(typeof body.enrolled).toBe('boolean');

  const sessions = await request.get('/api/auth/sessions', { headers: { Authorization: `Bearer ${token}` } });
  expect(sessions.ok()).toBeTruthy();
  expect((await sessions.json()).data.length).toBeGreaterThan(0);
});

test('audit log export respects filters and requires a session', async ({ page, request }) => {
  const anonymous = await request.get('/api/audit/export.csv');
  expect([401, 403]).toContain(anonymous.status());

  await login(page);
  await page.goto('/audit');
  await expect(page.getByTestId('audit-export')).toBeVisible();
  const { token } = await loginToken(request);
  const res = await request.get('/api/audit/export.csv?entity_type=mcp', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['content-type']).toContain('text/csv');
  const csv = await res.text();
  expect(csv.split('\n')[0]).toContain('created_at,actor_id,actor_name,actor_role,action');
});

test('unknown accounts hit progressive lockout and 429 with Retry-After', async ({ request }) => {
  const identifier = `nobody-${Date.now()}@example.com`;
  for (let i = 0; i < 5; i += 1) {
    const res = await request.post('/api/auth/login', { data: { email: identifier, password: 'wrong-password' } });
    expect(res.status()).toBe(i === 4 ? 429 : 401);
    if (i === 4) expect(res.headers()['retry-after']).toBeTruthy();
  }
});

test('logout revokes the interactive session', async ({ request }) => {
  const { token, mfaRequired } = await loginToken(request);
  test.skip(mfaRequired, 'MFA challenge requires a second step');
  const headers = { Authorization: `Bearer ${token}` };
  const logout = await request.post('/api/auth/logout', { headers });
  expect(logout.ok()).toBeTruthy();
  const me = await request.get('/api/auth/me', { headers });
  expect(me.status()).toBe(401);
});
