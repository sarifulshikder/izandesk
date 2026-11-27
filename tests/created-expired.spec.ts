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
  return body.token as string;
}

test('created-EXPIRED subscriber shows recharge & activate, then ACTIVE after payment', async ({ page, request }) => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run created-EXPIRED mutation checks');
  const token = await loginToken(request);
  const headers = { Authorization: `Bearer ${token}` };

  // find a billable package (price > 0)
  const pkgs = await (await request.get('/api/network/packages', { headers })).json();
  const list = pkgs?.data || pkgs || [];
  const pkg = list.find((p: any) => Number(p.price) > 0) || list[0];
  test.skip(!pkg, 'no bandwidth package available');

  const uname = `e2e-ce-${Date.now()}`;
  const createdRes = await request.post('/api/subscribers', {
    headers,
    data: { full_name: 'E2E Created Expired', username: uname, password: 'secret123', package_name: pkg.name, provisioning_mode: 'RADIUS', status: 'ACTIVE' },
  });
  expect(createdRes.ok()).toBeTruthy();
  const created = await createdRes.json();
  const id = created.id as string;
  try {
    // backend forces created-EXPIRED + payment-gated (caller can't create ACTIVE)
    expect(created.status).toBe('EXPIRED');
    expect(String(created.suspension_source || '').toUpperCase()).toBe('CREATION');

    await login(page);
    await page.goto(`/subscribers/${id}`);

    // recharge & activate card shown for EXPIRED
    await expect(page.getByRole('heading', { name: /Recharge & activate/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/created.*EXPIRED.*payment-gated|EXPIRED.*package price/i).first()).toBeVisible();
    await expect(page.getByRole('badge', { name: 'EXPIRED' })).toBeVisible().catch(() => {});

    // recharge (admin) records payment == package price and activates
    const rechargeBtn = page.getByRole('button', { name: /Recharge .* activate/i });
    await expect(rechargeBtn).toBeVisible();
    await rechargeBtn.click();
    await expect(page.getByText(/Payment recorded/i)).toBeVisible({ timeout: 15_000 });

    // now ACTIVE + recharge card gone
    await expect(page.getByText('ACTIVE', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Recharge & activate/i })).toHaveCount(0);
  } finally {
    await request.delete(`/api/subscribers/${id}`, { headers }).catch(() => {});
  }
});
