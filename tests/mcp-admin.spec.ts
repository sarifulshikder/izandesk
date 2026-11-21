import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const admin = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@izandesk.com',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
};

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'izandesk-e2e', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

async function login(page: Page) {
  await page.goto('/');
  await expect(page.locator('#login-username')).toBeVisible();
  await page.locator('#login-username').fill(admin.email);
  await page.locator('#login-password').fill(admin.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('#login-username')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(600);
}

async function gotoStable(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return;
    } catch (e: any) {
      const msg = String(e.message);
      const race = msg.includes('ERR_ABORTED') || msg.includes('interrupted by another navigation');
      if (!race || attempt === 2) throw e;
      await page.waitForTimeout(1000);
    }
  }
}

async function loginToken(request: APIRequestContext) {
  const res = await request.post('/api/auth/login', { data: admin });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.token as string;
}

test('MCP admin surface exposes settings, keys and client configuration', async ({ page, request }) => {
  await login(page);
  await gotoStable(page, '/settings');

  const tab = page.getByRole('button', { name: /MCP Server/ });
  await expect(tab).toBeVisible();
  await tab.click();

  await expect(page.getByText('MCP server & dedicated keys')).toBeVisible();
  await expect(page.getByText('Create a dedicated API key')).toBeVisible();
  await expect(page.getByText('Dedicated API keys')).toBeVisible();
  await expect(page.getByRole('link', { name: /View MCP audit events/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Copy client config template/ })).toBeVisible();
  await expect(page.getByText('Tool access')).toBeVisible();

  const token = await loginToken(request);
  const toolsRes = await request.get('/api/mcp/tools', { headers: { Authorization: `Bearer ${token}` } });
  expect(toolsRes.ok()).toBeTruthy();
  const tools = (await toolsRes.json()).data || [];
  expect(tools.length).toBeGreaterThan(10);
  expect(tools.some((t: any) => t.name === 'izandesk_overview')).toBeTruthy();
  expect(tools.every((t: any) => typeof t.destructive === 'boolean' && typeof t.read_only === 'boolean')).toBeTruthy();
});

test('MCP audit deep link filters to MCP events', async ({ page }) => {
  await login(page);
  const auditResponse = page.waitForResponse((r) => r.url().includes('/api/audit?entity_type=mcp') && r.status() === 200);
  await gotoStable(page, '/audit?entity_type=mcp');
  await auditResponse;
  await expect(page.getByRole('button', { name: 'MCP', exact: true })).toHaveClass(/active/);
});

test.describe('MCP key lifecycle (opt-in)', () => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run MCP key lifecycle checks');

  test('create, use and revoke a scoped key', async ({ request }) => {
    const token = await loginToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const name = `e2e-mcp-${Date.now()}`;
    let keyId = '';

    try {
      const createdRes = await request.post('/api/mcp/keys', {
        headers: auth,
        data: { name, role: 'SUPER_ADMIN', read_only: true, allowed_tools: ['izandesk_overview'] },
      });
      expect(createdRes.status()).toBe(201);
      const created = await createdRes.json();
      keyId = created.key_id;
      expect(created.secret).toMatch(/^izsk_/);

      const list = await request.get('/api/mcp/keys', { headers: auth });
      expect(list.ok()).toBeTruthy();
      expect((await list.json()).data.some((k: any) => k.key_id === keyId && k.name === name)).toBeTruthy();

      const basic = `Basic ${Buffer.from(`${keyId}:${created.secret}`).toString('base64')}`;
      const rpcRes = await request.post('/api/mcp', {
        headers: {
          Authorization: basic,
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        data: {
          jsonrpc: '2.0', id: 1, method: 'tools/list',
          params: { _meta: modernMeta },
        },
      });
      expect(rpcRes.ok()).toBeTruthy();
      const scoped = (await rpcRes.json()).result?.tools || [];
      expect(scoped.length).toBe(1);
      expect(scoped[0].name).toBe('izandesk_overview');
    } finally {
      if (keyId) {
        const revoked = await request.delete(`/api/mcp/keys/${encodeURIComponent(keyId)}`, { headers: auth });
        expect(revoked.ok()).toBeTruthy();
      }
    }
  });
});
