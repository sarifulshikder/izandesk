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
      const msg = String(e.message);
      const race = msg.includes('ERR_ABORTED') || msg.includes('interrupted by another navigation');
      if (!race || attempt === 2) throw e;
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
    // One MapLibre map drives both basemaps; satellite reuses the streets vector labels.
    await expect(page.locator('canvas.maplibregl-canvas').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-map-ready="1"]')).toBeVisible({ timeout: 20000 });
    const viewState = () => page.evaluate(() => {
      const m = (window as any).__gisMap;
      const meta = m?.getStyle()?.metadata;
      if (!meta) return null;
      return {
        satellite: m.getLayoutProperty(meta.satelliteLayer, 'visibility'),
        labels: m.getLayoutProperty(meta.labelLayers[0], 'visibility'),
        labelCount: meta.labelLayers.length,
      };
    });
    const satelliteView = await viewState();
    expect(satelliteView?.satellite).toBe('visible');
    expect(satelliteView?.labels).toBe('visible');
    expect(satelliteView?.labelCount).toBeGreaterThan(10);
    await page.getByRole('button', { name: 'Labels on' }).click();
    await expect.poll(async () => (await viewState())?.labels).toBe('none');
    await page.getByRole('button', { name: 'Labels off' }).click();
    await expect.poll(async () => (await viewState())?.labels).toBe('visible');
    await page.getByLabel('Heatmap').check();
    await expect(page.locator('[data-heatmap="on"]')).toBeVisible();
    await expect.poll(async () => page.evaluate(() =>
      (window as any).__gisMap.getLayoutProperty('gis-heat', 'visibility'))).toBe('visible');
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

test.describe('subscriber scoping', () => {
  test('reseller cannot cross tenant boundaries and live payload hides credentials', async ({ request }) => {
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const adminToken = await loginToken(request, admin);
    const resellerToken = await loginToken(request, reseller);

    const allRes = await request.get('/api/subscribers?limit=200', { headers: auth(adminToken) });
    const ownRes = await request.get('/api/subscribers?limit=200', { headers: auth(resellerToken) });
    expect(allRes.ok()).toBeTruthy();
    expect(ownRes.ok()).toBeTruthy();
    const all = (await allRes.json()).data || [];
    const own = (await ownRes.json()).data || [];
    expect(own.length, 'reseller fixture should own at least one subscriber').toBeGreaterThan(0);

    const ownIds = new Set(own.map((s: any) => s.id));
    // Prefer an unassigned subscriber: it exercises the null-uuid IDOR fallback.
    const target = all.find((s: any) => !ownIds.has(s.id) && !s.reseller_id) || all.find((s: any) => !ownIds.has(s.id));
    expect(target, 'need a subscriber outside this reseller scope').toBeTruthy();

    // H2: by-id read must fail closed even when reseller_id is NULL.
    const detail = await request.get(`/api/subscribers/${target.id}`, { headers: auth(resellerToken) });
    expect(detail.status(), 'reseller must not read a foreign/unassigned subscriber').toBe(404);

    // H1: the enhancement routers must be tenant-scoped for reads.
    const comm = await request.get(`/api/subscriber-communications/subscriber/${target.id}`, { headers: auth(resellerToken) });
    expect(comm.status()).toBe(404);
    const equip = await request.get(`/api/subscriber-equipment/subscriber/${target.id}`, { headers: auth(resellerToken) });
    expect(equip.status()).toBe(404);

    const commList = await request.get(`/api/subscriber-communications?subscriber_id=${target.id}`, { headers: auth(resellerToken) });
    expect(commList.ok()).toBeTruthy();
    expect((await commList.json()).data.every((c: any) => c.subscriber_id !== target.id)).toBe(true);
    const equipList = await request.get(`/api/subscriber-equipment?subscriber_id=${target.id}`, { headers: auth(resellerToken) });
    expect(equipList.ok()).toBeTruthy();
    expect((await equipList.json()).data.every((e: any) => e.subscriber_id !== target.id)).toBe(true);

    // H3 + M1: own live payload carries no credentials, and own history is reachable.
    const mine = own[0];
    const live = await request.get(`/api/subscribers/${mine.id}/live`, { headers: auth(resellerToken) });
    expect(live.ok()).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call((await live.json()).subscriber, 'password')).toBe(false);
    const history = await request.get(`/api/subscribers/${mine.id}/history`, { headers: auth(resellerToken) });
    expect(history.status(), 'reseller should see their own subscriber history').toBe(200);

    // M2: a reseller cannot reassign their subscriber to another partner via PUT.
    const reassigned = await request.put(`/api/subscribers/${mine.id}`, {
      headers: auth(resellerToken),
      data: { reseller_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(reassigned.ok(), 'PUT with a foreign reseller_id must be rejected or overridden').toBeTruthy();
    const after = await request.get(`/api/subscribers/${mine.id}`, { headers: auth(resellerToken) });
    expect((await after.json()).reseller_id).toBe(mine.reseller_id);

    // L1: KYC files are no longer publicly served; the checked route denies foreign subscribers.
    const oldKyc = await request.get('/uploads/kyc/nonexistent.pdf', { headers: auth(resellerToken) });
    expect(oldKyc.status()).toBe(404);
    const kycFile = await request.get(`/api/subscribers/${target.id}/kyc/00000000-0000-0000-0000-000000000000/file`, { headers: auth(resellerToken) });
    expect(kycFile.status()).toBe(404);

    // M3: raw provision is admin-only, and packages must exist in the catalog.
    const provision = await request.post('/api/subscribers/batch', {
      headers: auth(resellerToken), data: { action: 'provision', ids: [mine.id], params: { status: 'ACTIVE' } },
    });
    expect(provision.status()).toBe(400);
    const badPackage = await request.post('/api/subscribers/batch', {
      headers: auth(resellerToken), data: { action: 'set_package', ids: [mine.id], params: { package_name: 'no-such-package' } },
    });
    expect(badPackage.status()).toBe(400);
  });

  test('location picker uses MapLibre with no CDN marker icons', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await login(page, admin);
    await gotoStable(page, '/subscribers?new=1');
    const modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toContainText('Add Subscriber — Wizard');
    await modal.locator('input').first().fill('Picker Test Subscriber');
    await modal.getByRole('button', { name: 'Next' }).click();
    await modal.getByRole('button', { name: 'Next' }).click();
    await expect(modal.getByText('Map Pin Picker')).toBeVisible();
    await expect(page.locator('canvas.maplibregl-canvas').first()).toBeVisible({ timeout: 20000 });
    expect(await page.locator('img[src*="unpkg.com"]').count()).toBe(0);
    await expect(page.getByRole('button', { name: 'Satellite' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Streets' })).toBeVisible();

    // The leads wizard reuses the same picker — no Leaflet anywhere in the app.
    await gotoStable(page, '/leads?new=1');
    const leadModal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(leadModal).toContainText('Add Lead — Wizard');
    await leadModal.locator('input').first().fill('Picker Test Lead');
    await leadModal.getByRole('button', { name: 'Next' }).click();
    await expect(leadModal.getByText('Map Pin Picker')).toBeVisible();
    await expect(leadModal.locator('canvas.maplibregl-canvas').first()).toBeVisible({ timeout: 20000 });
    expect(await page.locator('img[src*="unpkg.com"], img.leaflet-tile').count()).toBe(0);
    expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
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

test.describe('billing payment security', () => {
  test('anonymous webhook and raw Bearer SMS ingest cannot record payments', async ({ request }) => {
    // No signature/secret: the webhook must fail closed instead of auto-trusting the body.
    const hook = await request.post('/api/billing/webhooks/bkash', {
      data: { amount: 999999, status: 'COMPLETED', trx_id: 'E2E-FORGE-HOOK' },
    });
    expect(hook.status()).toBe(401);

    // A raw Bearer string is not a verified JWT — the public SMS path must reject it.
    const sms = await request.post('/api/billing/payments/sms/ingest', {
      headers: { Authorization: 'Bearer definitely-not-a-jwt' },
      data: { gateway: 'bkash', amount: 999999, trx_id: 'E2E-FORGE-SMS', message: 'fake' },
    });
    expect(sms.status()).toBe(401);
  });

  test('reseller cannot reach tenant-wide billing APIs', async ({ request }) => {
    const token = await loginToken(request, reseller);
    const headers = { Authorization: `Bearer ${token}` };
    expect((await request.get('/api/billing/invoices', { headers })).status()).toBe(403);
    expect((await request.get('/api/billing/payments', { headers })).status()).toBe(403);
    expect((await request.post('/api/billing/gateways/bkash', { headers, data: { webhook_secret: 'attacker-secret' } })).status()).toBe(403);
    expect((await request.post('/api/billing/payments/checkout', { headers, data: { gateway: 'bkash', amount: 100 } })).status()).toBe(403);
  });

  test('invoice PDF/HTML links require a signed token', async ({ request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const list = await (await request.get('/api/billing/invoices', { headers })).json();
    const inv = (list.data || [])[0];
    test.skip(!inv, 'no invoice seeded for link test');
    expect((await request.get(`/api/billing/invoices/${inv.id}/pdf`)).status()).toBe(401);
    // The old scheme used the raw invoice id as the "token" — it must no longer work.
    expect((await request.get(`/api/billing/invoices/${inv.id}/pdf?token=${inv.id}`)).status()).toBe(401);
  });
});

test.describe('reseller module security', () => {
  test('customer 360 detail hides credentials and staff roles are scoped', async ({ request }) => {
    const adminToken = await loginToken(request, admin);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const resellers = (await (await request.get('/api/resellers', { headers: adminHeaders })).json()).data || [];
    const partner = resellers.find((r: any) => r.email === reseller.email) || resellers[0];
    test.skip(!partner, 'no reseller seeded');
    const subs = (await (await request.get(`/api/resellers/${partner.id}/subscribers`, { headers: adminHeaders })).json()).data || [];
    const sub = subs[0];
    test.skip(!sub, 'reseller has no subscribers');

    const resellerToken = await loginToken(request, reseller);
    const detail = await request.get(`/api/resellers/${partner.id}/customers/${sub.id}/detail`, { headers: { Authorization: `Bearer ${resellerToken}` } });
    expect(detail.ok()).toBeTruthy();
    const basic = (await detail.json()).data.basic;
    expect(basic).not.toHaveProperty('password');
    expect(basic).not.toHaveProperty('password_hash');

    // NOC engineers cannot move partner money or submit gateway top-ups.
    const nocToken = await loginToken(request, { email: process.env.E2E_NOC_EMAIL || 'noc@izandesk.com', password: process.env.E2E_NOC_PASSWORD || 'noc123' });
    const nocHeaders = { Authorization: `Bearer ${nocToken}` };
    expect((await request.post(`/api/resellers/${partner.id}/customers/${sub.id}/payment`, { headers: nocHeaders, data: { amount: 10 } })).status()).toBe(403);
    expect((await request.post(`/api/resellers/${partner.id}/wallet/topups`, { headers: nocHeaders, data: { amount: 100, gateway: 'BKASH', terms_accepted: true } })).status()).toBe(403);
  });
});

test.describe('network & OSS access control', () => {
  test('resellers are denied routers, OLT, RADIUS, WireGuard and ACS', async ({ request }) => {
    const token = await loginToken(request, reseller);
    const headers = { Authorization: `Bearer ${token}` };
    for (const path of ['/api/network/routers', '/api/olt/olts', '/api/radius/users', '/api/wireguard/peers', '/api/acs/devices']) {
      expect(await (await request.get(path, { headers })).status(), `${path} should be denied`).toBe(403);
    }
  });

  test('RADIUS user listing hides PPPoE passwords and write roles are enforced', async ({ request }) => {
    const adminToken = await loginToken(request, admin);
    const users = await (await request.get('/api/radius/users', { headers: { Authorization: `Bearer ${adminToken}` } })).json();
    expect((users.data || []).every((u: any) => !('password' in u))).toBe(true);

    const billingToken = await loginToken(request, { email: 'billing@izandesk.com', password: 'billing123' });
    const headers = { Authorization: `Bearer ${billingToken}` };
    expect((await request.get('/api/network/routers', { headers })).status()).toBe(200);
    expect((await request.post('/api/network/routers', { headers, data: {} })).status()).toBe(403);
    expect((await request.post('/api/radius/coa', { headers, data: { username: 'x', action: 'DISCONNECT' } })).status()).toBe(403);

    const routers = await (await request.get('/api/network/routers', { headers: { Authorization: `Bearer ${adminToken}` } })).json();
    const routerId = (routers.data || [])[0]?.id;
    if (routerId) {
      expect((await request.get(`/api/network/routers/${routerId}/mikrotik/import-preview?type=ppp-secrets`, { headers })).status()).toBe(403);
    }
  });
});

test.describe('CRM access control', () => {
  test('leads and messaging configuration are staff-only', async ({ request }) => {
    const token = await loginToken(request, reseller);
    const headers = { Authorization: `Bearer ${token}` };
    expect((await request.get('/api/leads', { headers })).status()).toBe(403);
    expect((await request.post('/api/leads', { headers, data: { full_name: 'x' } })).status()).toBe(403);
    expect((await request.get('/api/messaging/channels', { headers })).status()).toBe(403);
    expect((await request.get('/api/messaging/templates', { headers })).status()).toBe(403);
    const adminToken = await loginToken(request, admin);
    expect((await request.get('/api/leads', { headers: { Authorization: `Bearer ${adminToken}` } })).ok()).toBeTruthy();
  });
});

test.describe('remaining modules access control', () => {
  test('resellers cannot read inventory, global reports or hotspot reconciliation', async ({ request }) => {
    const token = await loginToken(request, reseller);
    const headers = { Authorization: `Bearer ${token}` };
    for (const path of [
      '/api/inventory/warehouses', '/api/inventory/items', '/api/inventory/serials',
      '/api/reports/overview', '/api/reports/profit-loss', '/api/reports/payroll',
      '/api/hotspot/summary', '/api/hotspot/reconciliation',
    ]) {
      expect(await (await request.get(path, { headers })).status(), `${path} should be denied`).toBe(403);
    }
    const adminToken = await loginToken(request, admin);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    for (const path of ['/api/inventory/warehouses', '/api/reports/overview', '/api/hotspot/summary']) {
      expect((await request.get(path, { headers: adminHeaders })).ok()).toBeTruthy();
    }
  });
});

test.describe('portal auth security', () => {
  test('subscriber portal login is rate-limited and tokens are role-separated', async ({ request }) => {
    // Unknown identifiers cannot be brute-forced: the 5th failure locks briefly.
    const identifier = `E2E-PORTAL-${Date.now()}`;
    for (let i = 0; i < 4; i++) {
      expect((await request.post('/api/portal/login', { data: { client_code: identifier, password: 'wrong' } })).status()).toBe(401);
    }
    expect((await request.post('/api/portal/login', { data: { client_code: identifier, password: 'wrong' } })).status()).toBe(429);

    // A staff JWT must not be accepted as a portal subscriber session.
    const adminToken = await loginToken(request, admin);
    expect((await request.get('/api/portal/me', { headers: { Authorization: `Bearer ${adminToken}` } })).status()).toBe(401);
  });
});

test.describe('billing mutating flows (opt-in)', () => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run data-mutating checks');

  test('invoice share links use signed tokens', async ({ request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const subs = await (await request.get('/api/subscribers?limit=100', { headers })).json();
    const sub = (subs.data || []).find((s: any) => Number(s.monthly_bill) > 0);
    test.skip(!sub, 'no billable subscriber seeded for invoice link test');
    const generated = await request.post('/api/billing/invoices/generate', {
      headers, data: { subscriber_id: sub.id, force: true },
    });
    expect(generated.ok()).toBeTruthy();
    const invoiceId = (await generated.json()).invoice?.id;
    test.skip(!invoiceId, 'invoice could not be generated');
    try {
      const share = await (await request.get(`/api/billing/invoices/${invoiceId}/share`, { headers })).json();
      const shareToken = new URL(share.pdf_url).searchParams.get('token');
      expect(shareToken).toBeTruthy();
      expect(shareToken).not.toBe(invoiceId);
      const pdfPath = new URL(share.pdf_url).pathname + new URL(share.pdf_url).search;
      expect((await request.get(pdfPath)).status()).toBe(200);
      expect((await request.get(`/api/billing/invoices/${invoiceId}/pdf?token=${invoiceId}`)).status()).toBe(401);
    } finally {
      await request.post(`/api/billing/invoices/${invoiceId}/cancel`, { headers });
    }
  });

  test('manual payment confirmation cannot inflate the stored amount', async ({ request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const checkout = await request.post('/api/billing/payments/checkout', {
      headers, data: { gateway: 'bkash', amount: 10, method: 'e2e' },
    });
    expect(checkout.ok()).toBeTruthy();
    const { payment } = await checkout.json();
    const confirm = await request.post(`/api/billing/payments/${payment.payment_ref}/confirm`, {
      headers, data: { amount: 999999, trx_id: `E2E-CONFIRM-${Date.now()}` },
    });
    expect(confirm.ok()).toBeTruthy();
    const list = await (await request.get('/api/billing/payments?status=COMPLETED', { headers })).json();
    const row = (list.data || []).find((p: any) => p.payment_ref === payment.payment_ref);
    expect(row).toBeTruthy();
    expect(Number(row.amount)).toBe(10);
  });
});

test.describe('portal mutating flows (opt-in)', () => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run data-mutating checks');

  test('hashed subscriber passwords work and a change invalidates old sessions', async ({ request }) => {
    const adminToken = await loginToken(request, admin);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const code = `PT-E2E-${Date.now().toString().slice(-6)}`;
    const created = await request.post('/api/subscribers', {
      headers: adminHeaders,
      data: { full_name: 'Portal Auth Test', client_code: code, username: code, password: 'PortalTest@123' },
    });
    expect(created.ok()).toBeTruthy();
    const subId = (await created.json()).id;
    let portalToken = '';
    try {
      const login = await request.post('/api/portal/login', { data: { client_code: code, password: 'PortalTest@123' } });
      expect(login.ok()).toBeTruthy();
      portalToken = (await login.json()).token;
      const headers = { Authorization: `Bearer ${portalToken}` };
      expect((await request.get('/api/portal/me', { headers })).ok()).toBeTruthy();

      // An admin password change must also update the portal credential.
      const adminEdit = await request.put(`/api/subscribers/${subId}`, {
        headers: adminHeaders, data: { full_name: 'Portal Auth Test', password: 'PortalEdited@123' },
      });
      expect(adminEdit.ok()).toBeTruthy();
      expect((await request.post('/api/portal/login', { data: { client_code: code, password: 'PortalTest@123' } })).status()).toBe(401);
      const editedLogin = await request.post('/api/portal/login', { data: { client_code: code, password: 'PortalEdited@123' } });
      expect(editedLogin.ok()).toBeTruthy();
      portalToken = (await editedLogin.json()).token;

      const change = await request.post('/api/portal/change-password', {
        headers: { Authorization: `Bearer ${portalToken}` },
        data: { current_password: 'PortalEdited@123', new_password: 'PortalTest@456' },
      });
      expect(change.ok()).toBeTruthy();
      // The previously issued token is now stale.
      expect((await request.get('/api/portal/me', { headers })).status()).toBe(401);
      const relogin = await request.post('/api/portal/login', { data: { client_code: code, password: 'PortalTest@456' } });
      expect(relogin.ok()).toBeTruthy();
      portalToken = (await relogin.json()).token;
      expect((await request.get('/api/portal/me', { headers: { Authorization: `Bearer ${portalToken}` } })).ok()).toBeTruthy();

      // KYC uploads reject non-image/non-PDF content instead of storing it.
      const upload = await request.post('/api/portal/documents', {
        headers: { Authorization: `Bearer ${portalToken}` },
        multipart: { file: { name: 'evil.txt', mimeType: 'text/plain', buffer: Buffer.from('not a document') } },
      });
      expect(upload.status()).toBe(400);
    } finally {
      await request.delete(`/api/subscribers/${subId}`, { headers: adminHeaders });
    }
  });
});

test.describe('reseller mutating flows (opt-in)', () => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run data-mutating checks');

  test('wallet top-up decisions are bound to the reseller in the path', async ({ request }) => {
    const adminToken = await loginToken(request, admin);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const resellers = (await (await request.get('/api/resellers', { headers: adminHeaders })).json()).data || [];
    const partner = resellers.find((r: any) => r.email === reseller.email) || resellers[0];
    const other = resellers.find((r: any) => r.id !== partner?.id);
    test.skip(!partner || !other, 'need two resellers for top-up binding test');

    const token = await loginToken(request, reseller);
    const submitted = await request.post(`/api/resellers/${partner.id}/wallet/topups`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { amount: 100, gateway: 'BKASH', terms_accepted: true },
    });
    expect(submitted.ok()).toBeTruthy();
    const tid = (await submitted.json()).data.id;
    try {
      // A pending request cannot be decided through another reseller's URL.
      expect((await request.post(`/api/resellers/${other.id}/wallet/topups/${tid}/reject`, { headers: adminHeaders })).status()).toBe(404);
      // NOC engineers still cannot decide it.
      const nocToken = await loginToken(request, { email: 'noc@izandesk.com', password: 'noc123' });
      expect((await request.post(`/api/resellers/${partner.id}/wallet/topups/${tid}/reject`, { headers: { Authorization: `Bearer ${nocToken}` } })).status()).toBe(403);
      expect((await request.post(`/api/resellers/${partner.id}/wallet/topups/${tid}/reject`, { headers: adminHeaders })).ok()).toBeTruthy();
    } catch (e) {
      // Best-effort cleanup if the flow is interrupted.
      await request.post(`/api/resellers/${partner.id}/wallet/topups/${tid}/reject`, { headers: adminHeaders }).catch(() => {});
      throw e;
    }
  });
});

test.describe('CRM mutating flows (opt-in)', () => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run data-mutating checks');

  test('ticket comments cannot leak internal notes or impersonate staff', async ({ request }) => {
    const adminToken = await loginToken(request, admin);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const partners = (await (await request.get('/api/resellers', { headers: adminHeaders })).json()).data || [];
    const partner = partners.find((r: any) => r.email === reseller.email) || partners[0];
    test.skip(!partner, 'no reseller seeded');

    const created = await request.post('/api/tickets', {
      headers: adminHeaders,
      data: { subject: `E2E CRM ${Date.now()}`, reseller_id: partner.id, ticket_no: 'SPOOFED' },
    });
    expect(created.ok()).toBeTruthy();
    const ticket = (await created.json()).data;
    expect(ticket.ticket_no).not.toBe('SPOOFED');
    let ticketId = ticket.id;
    try {
      await request.post(`/api/tickets/${ticketId}/comments`, {
        headers: adminHeaders, data: { body: 'internal-only note', is_internal: true },
      });
      const resellerToken = await loginToken(request, reseller);
      const spoof = await request.post(`/api/tickets/${ticketId}/comments`, {
        headers: { Authorization: `Bearer ${resellerToken}` },
        data: { body: 'partner note', author_role: 'SUPER_ADMIN', author_name: 'Fake Admin', is_internal: true },
      });
      expect(spoof.ok()).toBeTruthy();
      const spoofed = (await spoof.json()).data;
      expect(spoofed.author_role).toBe('RESELLER');
      expect(spoofed.is_internal).toBe(false);

      const resellerView = await (await request.get(`/api/tickets/${ticketId}`, { headers: { Authorization: `Bearer ${resellerToken}` } })).json();
      const resellerComments = resellerView.data.comments || [];
      expect(resellerComments.some((c: any) => c.body === 'internal-only note')).toBe(false);
      expect(resellerComments.some((c: any) => c.body === 'partner note')).toBe(true);
      const adminView = await (await request.get(`/api/tickets/${ticketId}`, { headers: adminHeaders })).json();
      expect((adminView.data.comments || []).some((c: any) => c.body === 'internal-only note')).toBe(true);
    } finally {
      await request.put(`/api/tickets/${ticketId}`, { headers: adminHeaders, data: { status: 'CLOSED' } }).catch(() => {});
    }
  });

  test('lead numbers are unique and sequential', async ({ request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const ids: string[] = [];
    try {
      const a = await (await request.post('/api/leads', { headers, data: { full_name: 'E2E Lead A' } })).json();
      const b = await (await request.post('/api/leads', { headers, data: { full_name: 'E2E Lead B' } })).json();
      ids.push(a.lead.id, b.lead.id);
      expect(a.lead.lead_no).not.toBe(b.lead.lead_no);
      expect(a.lead.lead_no).toMatch(/^LD-\d{6}-\d{5}$/);
    } finally {
      for (const id of ids) await request.delete(`/api/leads/${id}`, { headers }).catch(() => {});
    }
  });
});

test.describe('import mutating flows (opt-in)', () => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run data-mutating checks');

  test('preview and execute share the same row validation', async ({ request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const username = `dedupe${Date.now().toString().slice(-7)}`;
    const csv = 'Full Name,Username,Password,Monthly Bill,Provisioning Mode,Email\n' +
      `Dedupe Valid,${username},Test@12345,500,RADIUS,valid@example.com\n` +
      'Dedupe Invalid,dedupeinvalid,Test@12345,not-a-number,RADIUS,bad-email\n';
    const file = { name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };

    const preview = await (await request.post('/api/subscribers/import/preview', { headers, multipart: { file } })).json();
    expect(preview.valid).toBe(1);
    expect(preview.invalid).toBe(1);
    expect(preview.errors.join(' ')).toContain('monthly_bill');

    const executed = await (await request.post('/api/subscribers/import/execute', {
      headers, multipart: { file, force: 'true' },
    })).json();
    expect(executed.created).toBe(1);
    expect(executed.failed).toBe(1);
    expect(executed.results.find((r: any) => !r.ok).error).toContain('monthly_bill');

    const listed = await (await request.get(`/api/subscribers?q=${username}`, { headers })).json();
    const created = (listed.data || []).find((s: any) => s.username === username);
    if (created) await request.delete(`/api/subscribers/${created.id}`, { headers });
  });
});
