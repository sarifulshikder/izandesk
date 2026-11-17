import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const admin = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@izandesk.com',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
};
const reseller = {
  email: process.env.E2E_RESELLER_EMAIL || 'reseller@cybernet.bd',
  password: process.env.E2E_RESELLER_PASSWORD || 'reseller123',
};

const RESELLER_TABS = [
  'Dashboard', 'Users', 'Online Users', 'Balance Report', 'Sharing Report', 'Payments',
  'ONU List', 'Logs', 'Notifications', 'Branches', 'Complaints', 'Parental Control',
  'Billing Overview', 'Invoice Payments', 'Online Payments', 'RADIUS Log', 'Login Log',
];

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto('/');
  await expect(page.locator('#login-username')).toBeVisible();
  await page.locator('#login-username').fill(creds.email);
  await page.locator('#login-password').fill(creds.password);
  await page.locator('button[type="submit"]').click();
  // Poll for the form to disappear rather than depending on navigation events,
  // which are slow and noisy on a cold Next dev server.
  await expect(page.locator('#login-username')).toHaveCount(0, { timeout: 30_000 });
  // Give the post-login redirect time to settle before the test navigates again.
  await page.waitForTimeout(800);
}

async function gotoStable(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return;
    } catch (e: any) {
      if (!String(e.message).includes('ERR_ABORTED') || attempt === 2) throw e;
      await page.waitForTimeout(1000);
    }
  }
}

async function loginToken(request: APIRequestContext, creds: { email: string; password: string }) {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', r => {
    if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`api ${r.status()}: ${r.url()}`);
  });
  return errors;
}

test.describe('reseller portal', () => {
  test('all 17 portal tabs render without console or API errors', async ({ page }) => {
    const errors = watchErrors(page);
    await login(page, reseller);
    await gotoStable(page, '/resellers');
    await expect(page.locator('h1')).toContainText('Reseller Portal');

    for (const name of RESELLER_TABS) {
      const tab = page.locator('main button').filter({ hasText: new RegExp(`^${name}$`) }).first();
      await expect(tab, `missing tab: ${name}`).toBeVisible();
      await tab.click();
      await expect(page.locator('main')).not.toBeEmpty();
      expect((await page.locator('main').innerText()).length, `empty content for ${name}`).toBeGreaterThan(80);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Add and Edit both open the shared subscriber wizard', async ({ page }) => {
    await login(page, reseller);
    await gotoStable(page, '/resellers?tab=users');

    await page.getByRole('button', { name: /Add Subscriber/ }).first().click();
    let modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toContainText('Add Subscriber — Wizard');
    await expect(modal).toContainText('Step 1 of 4'); // same as admin panel
    await modal.getByRole('button', { name: /Cancel/ }).click();

    await page.locator('main tr').filter({ hasText: /.+/ }).getByRole('button', { name: /^Edit$/ }).first().click();
    modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toContainText('Edit Subscriber — Wizard');
    await expect(modal).toContainText('Step 1 of 5');
    await expect(modal).toContainText('Additional Details');
  });

  test('dashboard KPI cards open their scoped modules', async ({ page }) => {
    await login(page, reseller);
    await gotoStable(page, '/resellers');

    await page.locator('main button').filter({ hasText: /^Complaints/ }).first().click();
    await expect(page).toHaveURL(/tab=complaints/);
    await expect(page.locator('main')).toContainText('File Complaint');

    await gotoStable(page, '/resellers');
    await page.locator('main button').filter({ hasText: /^Parental Control/ }).first().click();
    await expect(page).toHaveURL(/tab=parental/);
    await expect(page.locator('main')).toContainText('protected)');
  });

  test('foreign subscriber data is not reachable by a reseller', async ({ request }) => {
    const adminToken = await loginToken(request, admin);
    const list = await request.get('/api/subscribers?limit=100', { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(list.ok()).toBeTruthy();
    const foreign = ((await list.json()).data || []).find((s: any) => !s.reseller_id);
    test.skip(!foreign, 'no unassigned subscriber available to test scoping');

    const partners = await request.get('/api/resellers', { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(partners.ok()).toBeTruthy();
    const partner = ((await partners.json()).data || []).find((r: any) => r.email === reseller.email);
    const rid = process.env.E2E_RESELLER_ID || partner?.id;
    test.skip(!rid, 'could not resolve the reseller id');

    const token = await loginToken(request, reseller);
    const headers = { Authorization: `Bearer ${token}` };

    for (const path of [
      `/api/subscribers/${foreign.id}/kyc`,
      `/api/subscribers/${foreign.id}/live`,
      `/api/resellers/${rid}/customers/${foreign.id}/detail`,
    ]) {
      const res = await request.get(path, { headers });
      expect(res.status(), `${path} should be hidden`).toBe(404);
    }
    const complaint = await request.post(`/api/resellers/${rid}/complaints`, {
      headers,
      data: { subject: 'should be rejected', subscriber_id: foreign.id },
    });
    expect(complaint.status()).toBe(404);
  });
});

test.describe('mutating flows (opt-in)', () => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run data-mutating checks');

  test('reseller can create and delete their own subscriber via the wizard', async ({ page, request }) => {
    const adminToken = await loginToken(request, admin);
    const partners = await request.get('/api/resellers', { headers: { Authorization: `Bearer ${adminToken}` } });
    const partner = ((await partners.json()).data || []).find((r: any) => r.email === reseller.email);
    const rid = process.env.E2E_RESELLER_ID || partner?.id;
    test.skip(!rid, 'could not resolve the reseller id');

    const token = await loginToken(request, reseller);
    const headers = { Authorization: `Bearer ${token}` };
    const username = `smoke${Date.now().toString().slice(-6)}`;
    let clientCode = '';

    try {
      await login(page, reseller);
      await gotoStable(page, '/resellers?tab=users');
      await page.getByRole('button', { name: /Add Subscriber/ }).first().click();
      const modal = page.locator('div.fixed.inset-0.z-50').last();

      await modal.locator('input').first().fill('Smoke Test User');
      await modal.getByRole('button', { name: /Next/ }).click();
      await modal.locator('label').filter({ hasText: 'PPPoE Username' }).locator('input').fill(username);
      await modal.getByRole('button', { name: /Next/ }).click();
      await modal.getByRole('button', { name: /Next/ }).click();
      await modal.getByRole('button', { name: /Create Subscriber/ }).click();

      await expect(page.locator('main')).toContainText('Subscriber created:');
      const text = await page.locator('main').innerText();
      clientCode = (text.match(/Subscriber created:\s*([A-Z0-9-]+)/) || [])[1] || '';
      expect(clientCode).toBeTruthy();
    } finally {
      if (clientCode) {
        const found = await request.get(`/api/resellers/${rid}/users?q=${encodeURIComponent(clientCode)}`, { headers });
        const row = ((await found.json()).data || [])[0];
        if (row) {
          const deleted = await request.delete(`/api/subscribers/${row.id}`, { headers });
          expect(deleted.ok(), `cleanup failed for ${clientCode}`).toBeTruthy();
        }
      }
    }
  });
});

test.describe('reseller mobile bottom nav', () => {
  test('exposes Complaints and Parental Control with query-aware active state', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, reseller);
    const nav = page.locator('nav.lg\\:hidden').first();
    await expect(nav.getByRole('link', { name: 'Complaints' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Parental' })).toBeVisible();

    await nav.getByRole('link', { name: 'Complaints' }).click();
    await expect(page).toHaveURL(/tab=complaints/);
    await expect(nav.getByRole('link', { name: 'Complaints' })).toHaveClass(/bg-primary\/10/);

    await nav.getByRole('link', { name: 'Parental' }).click();
    await expect(page).toHaveURL(/tab=parental/);
    await expect(nav.getByRole('link', { name: 'Parental' })).toHaveClass(/bg-primary\/10/);

    const overflow = await nav.evaluate(el => el.scrollWidth > el.clientWidth);
    expect(overflow, 'bottom nav should fit a phone viewport').toBe(false);
  });
});

test.describe('admin subscriber wizard', () => {
  test('Add, Edit and ?new=1 all open the shared wizard', async ({ page }) => {
    await login(page, admin);
    await gotoStable(page, '/subscribers');

    await page.getByRole('button', { name: /Add Subscriber/ }).first().click();
    let modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toContainText('Add Subscriber — Wizard');
    await expect(modal).toContainText('Subscriber Ownership');
    await modal.getByRole('button', { name: /Cancel/ }).click();

    await page.getByRole('button', { name: 'Edit' }).first().click();
    modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toContainText('Edit Subscriber — Wizard');
    await expect(modal).not.toContainText('Step 1 of 5');
    await modal.getByRole('button', { name: /Cancel/ }).click();

    await gotoStable(page, '/subscribers?new=1');
    modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toContainText('Add Subscriber — Wizard');
  });
});

test.describe('GIS authorization', () => {
  test('reseller is denied GIS reads and topology mutations, but keeps reference reads', async ({ request }) => {
    const adminToken = await loginToken(request, admin);
    const resellerToken = await loginToken(request, reseller);
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

    const adminOverview = await request.get('/api/gis/overview', { headers: auth(adminToken) });
    expect(adminOverview.ok()).toBeTruthy();
    const traceId = adminOverview.ok()
      ? (await adminOverview.json()).subscribers?.features?.[0]?.properties?.id
      : undefined;
    if (traceId) {
      const adminTrace = await request.get(`/api/gis/trace/subscriber/${traceId}`, { headers: auth(adminToken) });
      expect(adminTrace.ok(), `admin trace for ${traceId}`).toBeTruthy();
    }

    // Viewport filtering, live sessions and geocoding are all admin-guarded too.
    for (const path of ['/api/gis/live-sessions', '/api/gis/geocode?q=Mirpur']) {
      expect((await request.get(path, { headers: auth(resellerToken) })).status()).toBe(403);
    }
    for (const path of ['/api/topology/audit', '/api/topology/trash']) {
      expect((await request.get(path, { headers: auth(resellerToken) })).status()).toBe(403);
    }

    // Read-only roles can browse GIS and governance, but cannot mutate topology.
    const billingToken = await loginToken(request, { email: process.env.E2E_BILLING_EMAIL || 'billing@izandesk.com', password: process.env.E2E_BILLING_PASSWORD || 'billing123' });
    expect((await request.get('/api/gis/overview', { headers: auth(billingToken) })).status()).toBe(200);
    expect((await request.get('/api/topology/audit', { headers: auth(billingToken) })).status()).toBe(200);
    expect((await request.get('/api/topology/trash', { headers: auth(billingToken) })).status()).toBe(200);
    expect((await request.post('/api/topology/areas', { headers: auth(billingToken), data: { name: 'E2E read-only' } })).status()).toBe(403);
    expect((await request.post('/api/topology/import', { headers: auth(billingToken), data: { features: [] } })).status()).toBe(403);
    expect((await request.post('/api/topology/trash/00000000-0000-0000-0000-000000000000/restore', { headers: auth(billingToken) })).status()).toBe(403);
    const outside = await request.get('/api/gis/overview?bbox=90,23,91,24', { headers: auth(adminToken) });
    const inside = await request.get('/api/gis/overview?bbox=89,22,90,23', { headers: auth(adminToken) });
    expect((await outside.json()).subscribers.features.length).toBe(0);
    expect((await inside.json()).subscribers.features.length).toBeGreaterThanOrEqual(1);

    for (const path of ['/api/gis/overview', '/api/gis/trace/subscriber/00000000-0000-0000-0000-000000000000', '/api/gis/boxes/00000000-0000-0000-0000-000000000000/details']) {
      const r = await request.get(path, { headers: auth(resellerToken) });
      expect(r.status(), `reseller GET ${path}`).toBe(403);
    }
    const overviewBody = await adminOverview.json();
    expect(overviewBody.summary).toBeTruthy();
    const firstBox = overviewBody.boxes?.features?.[0]?.properties?.id;
    if (firstBox) {
      const details = await request.get(`/api/gis/boxes/${firstBox}/details`, { headers: auth(adminToken) });
      expect(details.ok(), 'admin box details').toBeTruthy();
    }
    const mutation = await request.post('/api/topology/areas', {
      headers: auth(resellerToken),
      data: { name: 'E2E should not be created' },
    });
    expect(mutation.status()).toBe(403);

    // The reseller subscriber wizard still needs read-only topology lookups.
    const reference = await request.get('/api/topology/areas', { headers: auth(resellerToken) });
    expect(reference.ok()).toBeTruthy();

    // Duplicate topology names must be a friendly 409, never a raw 500.
    const tempArea = await request.post('/api/topology/areas', { headers: auth(adminToken), data: { name: 'E2E dup check' } });
    expect(tempArea.ok()).toBeTruthy();
    const tempId = (await tempArea.json()).id;
    try {
      const dup = await request.post('/api/topology/areas', { headers: auth(adminToken), data: { name: 'E2E dup check' } });
      expect(dup.status()).toBe(409);
    } finally {
      await request.delete(`/api/topology/areas/${tempId}`, { headers: auth(adminToken) });
    }
  });

  test('reseller navigating directly to /gis sees an access-restricted page', async ({ page }) => {
    await login(page, reseller);
    await gotoStable(page, '/gis');
    await expect(page.getByText('Access restricted')).toBeVisible();
    await expect(page.getByText('Fiber GIS Map & Topology')).toHaveCount(0);
  });

  test('admin GIS workbench exposes KPIs, layers and management panels', async ({ page }) => {
    // Tile/image requests can be blocked in CI; only watch our own API.
    const apiErrors: string[] = [];
    page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) apiErrors.push(`${r.status()}: ${r.url()}`); });
    await login(page, admin);
    await gotoStable(page, '/gis');
    await expect(page.getByRole('heading', { name: 'Fiber GIS Map & Topology' })).toBeVisible();
    await expect(page.getByText('Geo coverage')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom to fit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export GeoJSON' })).toBeVisible();
    await expect(page.getByText('Map layers')).toBeVisible();
    await expect(page.getByLabel('Boxes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Streets' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Satellite' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Satellite' }), 'satellite should be the default basemap').toHaveClass(/bg-primary/);
    await page.getByRole('button', { name: 'Streets' }).click();
    await expect(page.getByRole('button', { name: 'Streets' })).toHaveClass(/bg-primary/);
    await gotoStable(page, '/gis');
    await expect(page.getByRole('button', { name: 'Streets' }), 'basemap choice should persist').toHaveClass(/bg-primary/);
    await page.getByRole('button', { name: 'Satellite' }).click();
    await page.getByLabel('Heatmap').check();
    await expect(page.locator('canvas.leaflet-heatmap-layer')).toHaveCount(1);
    await page.getByLabel('Live sessions').check();
    await expect(page.getByLabel('Live sessions')).toBeChecked();

    await page.getByRole('button', { name: 'Areas & Zones' }).click();
    await expect(page.getByPlaceholder('New area name')).toBeVisible();

    // Toolbar buttons swap the side panel directly — no need to close first.
    await page.getByRole('button', { name: 'Add Box', exact: true }).click();
    await expect(page.getByText('Add Distribution Box', { exact: true }).first()).toBeVisible();
    expect(apiErrors, `API errors: ${apiErrors.join('; ')}`).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, 'GIS workbench should not scroll horizontally on a phone').toBe(false);
  });

  test('billing role sees a read-only workbench with governance views', async ({ page }) => {
    const apiErrors: string[] = [];
    // The global system-status widget is admin-only; its 403 is expected here.
    page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/') && !r.url().includes('/api/system/diagnostics')) apiErrors.push(`${r.status()}: ${r.url()}`); });
    await login(page, { email: process.env.E2E_BILLING_EMAIL || 'billing@izandesk.com', password: process.env.E2E_BILLING_PASSWORD || 'billing123' });
    await gotoStable(page, '/gis');
    await expect(page.getByText('Read-only')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Box', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Draw Route' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Audit log' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trash' })).toBeVisible();
    await page.getByRole('button', { name: 'Audit log' }).click();
    await expect(page.getByText('Topology Audit Log')).toBeVisible();
    await page.getByRole('button', { name: 'Trash' }).click();
    await expect(page.getByText('Deleted Topology (Trash)')).toBeVisible();
    expect(apiErrors, `API errors: ${apiErrors.join('; ')}`).toEqual([]);
  });
});

test.describe('GIS mutating flows (opt-in)', () => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run data-mutating checks');

  test('admin can create, edit, drag, undo and delete a box on the map', async ({ page, request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const stamp = Date.now().toString().slice(-6);
    const name = `E2E GIS ${stamp}`;
    const renamed = `${name} edited`;
    const code = `E2EGIS-${stamp}`;
    let boxId = '';
    page.on('dialog', d => d.accept());

    const boxes = async () => (await (await request.get('/api/topology/boxes', { headers })).json()).data as any[];
    try {
      await login(page, admin);
      await gotoStable(page, '/gis');

      await page.getByRole('button', { name: 'Add Box', exact: true }).click();
      await page.getByLabel('Name').fill(name);
      await page.getByLabel('Code').fill(code);
      await page.getByLabel('Latitude').fill('23.770000');
      await page.getByLabel('Longitude').fill('90.400000');
      await page.getByRole('button', { name: 'Save Distribution Box' }).click();
      await expect(page.getByText('Distribution box created')).toBeVisible();

      boxId = (await boxes()).find(b => b.name === name)?.id || '';
      expect(boxId, 'created box should exist in the API').toBeTruthy();

      // Edit through the side list.
      await page.locator(`[data-box-row="${boxId}"] button[title="Edit"]`).click();
      await page.getByLabel('Name').fill(renamed);
      await page.getByRole('button', { name: 'Save Distribution Box' }).click();
      await expect(page.getByText('Distribution box updated')).toBeVisible();
      expect((await boxes()).find(b => b.id === boxId)?.name).toBe(renamed);

      // Drag the marker and verify the new coordinates persisted.
      const marker = page.locator(`.gis-box-marker:has([data-box-id="${boxId}"])`);
      await expect(marker).toBeVisible();
      const bb = await marker.boundingBox();
      expect(bb).toBeTruthy();
      await page.mouse.move(bb!.x + bb!.width / 2, bb!.y + bb!.height / 2);
      await page.mouse.down();
      await page.mouse.move(bb!.x + bb!.width / 2 + 60, bb!.y + bb!.height / 2 + 40, { steps: 12 });
      await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Undo move' })).toBeVisible();
      const moved = (await boxes()).find(b => b.id === boxId)!;
      expect(Number(moved.latitude)).not.toBe(23.77);

      await page.getByRole('button', { name: 'Undo move' }).click();
      await expect(page.getByText('Move undone')).toBeVisible();
      const restored = (await boxes()).find(b => b.id === boxId)!;
      expect(Number(restored.latitude)).toBeCloseTo(23.77, 4);

      // Delete with confirmation.
      await page.locator(`[data-box-row="${boxId}"] button[title="Delete"]`).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
      await expect(page.getByText('Distribution box deleted')).toBeVisible();
      expect((await boxes()).some(b => b.id === boxId)).toBe(false);
      boxId = '';
    } finally {
      if (boxId) await request.delete(`/api/topology/boxes/${boxId}`, { headers });
    }
  });

  test('admin can create, rename and delete an area', async ({ page, request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const stamp = Date.now().toString().slice(-6);
    const name = `E2E Area ${stamp}`, renamed = `${name} renamed`;
    let areaId = '';
    page.on('dialog', d => d.accept());
    try {
      await login(page, admin);
      await gotoStable(page, '/gis');
      await page.getByRole('button', { name: 'Areas & Zones' }).click();
      await page.getByPlaceholder('New area name').fill(name);
      await page.getByRole('button', { name: 'Add', exact: true }).first().click();
      await expect(page.getByText('Area created')).toBeVisible();
      areaId = ((await (await request.get('/api/topology/areas', { headers })).json()).data || []).find((a: any) => a.name === name)?.id || '';
      expect(areaId, 'created area should exist').toBeTruthy();

      await page.locator(`[data-name-row="area-${areaId}"] button[title="Rename"]`).click();
      await page.locator(`[data-name-row="area-${areaId}"] input`).fill(renamed);
      await page.locator(`[data-name-row="area-${areaId}"] button`).filter({ hasText: 'Save' }).click();
      await expect(page.getByText('Area renamed')).toBeVisible();
      expect(((await (await request.get('/api/topology/areas', { headers })).json()).data || []).find((a: any) => a.id === areaId)?.name).toBe(renamed);

      await page.locator(`[data-name-row="area-${areaId}"] button[title="Delete"]`).click();
      await expect(page.getByText('Area deleted')).toBeVisible();
      areaId = '';
    } finally {
      if (areaId) await request.delete(`/api/topology/areas/${areaId}`, { headers });
    }
  });

  test('admin can bulk-import boxes and routes from GeoJSON', async ({ request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const stamp = Date.now().toString().slice(-6);
    const code = `E2EIMP-${stamp}`, routeName = `E2E imported route ${stamp}`;
    let boxId = '', routeId = '';
    try {
      const res = await request.post('/api/topology/import', {
        headers,
        data: { features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [90.41, 23.77] }, properties: { name: `E2E imported box ${stamp}`, code, capacity_ports: 8 } },
          { type: 'Feature', geometry: { type: 'LineString', coordinates: [[90.41, 23.77], [90.42, 23.78]] }, properties: { name: routeName, from_code: code } },
          { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} },
        ] },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.created.boxes).toBe(1);
      expect(body.created.routes).toBe(1);
      expect(body.skipped).toBe(1);

      const boxes = (await (await request.get('/api/topology/boxes', { headers })).json()).data || [];
      boxId = boxes.find((b: any) => b.code === code)?.id || '';
      const routes = (await (await request.get('/api/topology/fiber-routes', { headers })).json()).data || [];
      routeId = routes.find((r: any) => r.name === routeName)?.id || '';
      expect(boxId, 'imported box should exist').toBeTruthy();
      expect(routeId, 'imported route should exist').toBeTruthy();
    } finally {
      if (routeId) await request.delete(`/api/topology/fiber-routes/${routeId}`, { headers });
      if (boxId) await request.delete(`/api/topology/boxes/${boxId}`, { headers });
    }
  });

  test('deleted topology lands in trash, is audited, and can be restored', async ({ request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const name = `E2E gov ${Date.now().toString().slice(-6)}`;
    let areaId = '';
    try {
      const created = await request.post('/api/topology/areas', { headers, data: { name } });
      expect(created.ok()).toBeTruthy();
      areaId = (await created.json()).id;
      const audit = (await (await request.get('/api/topology/audit?limit=20', { headers })).json()).data || [];
      expect(audit.some((a: any) => a.entity_id === areaId && a.action === 'CREATE')).toBe(true);

      expect((await request.delete(`/api/topology/areas/${areaId}`, { headers })).ok()).toBeTruthy();
      const trash = (await (await request.get('/api/topology/trash', { headers })).json()).data || [];
      const entry = trash.find((t: any) => t.entity_id === areaId);
      expect(entry, 'deleted area should be in trash').toBeTruthy();

      const restored = await request.post(`/api/topology/trash/${entry.id}/restore`, { headers });
      expect(restored.ok()).toBeTruthy();
      const areas = (await (await request.get('/api/topology/areas', { headers })).json()).data || [];
      expect(areas.some((a: any) => a.id === areaId)).toBe(true);
      const audit2 = (await (await request.get('/api/topology/audit?limit=20', { headers })).json()).data || [];
      expect(audit2.some((a: any) => a.entity_id === areaId && a.action === 'RESTORE')).toBe(true);
    } finally {
      if (areaId) await request.delete(`/api/topology/areas/${areaId}`, { headers });
    }
  });
});
