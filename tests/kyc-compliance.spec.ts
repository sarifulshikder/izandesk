import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const admin = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@izandesk.com',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
};
const reseller = {
  email: process.env.E2E_RESELLER_EMAIL || 'reseller@cybernet.bd',
  password: process.env.E2E_RESELLER_PASSWORD || 'reseller123',
};

async function loginToken(request: APIRequestContext, creds: { email: string; password: string }) {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok(), `login failed for ${creds.email}`).toBeTruthy();
  const body = await res.json();
  return body.token as string;
}

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto('/');
  await expect(page.locator('#login-username')).toBeVisible();
  await page.locator('#login-username').fill(creds.email);
  await page.locator('#login-password').fill(creds.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('#login-username')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(500);
}

test.describe('KYC compliance API', () => {
  test('compliance endpoints require an authenticated session', async ({ request }) => {
    for (const path of [
      '/api/kyc/queue', '/api/kyc/summary', '/api/kyc/export.csv',
      '/api/compliance/submissions', '/api/kyc/legal-holds',
    ]) {
      const res = await request.get(path);
      expect([401, 403], `${path} must require auth`).toContain(res.status());
    }
  });

  test('settings expose a KYC category with manual-retention defaults', async ({ request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const schema = await request.get('/api/settings/schema', { headers });
    expect(schema.ok()).toBeTruthy();
    const body = await schema.json();
    expect(body.categories.kyc).toBeTruthy();
    const keys = (body.fields || []).filter((f: any) => f.category === 'kyc').map((f: any) => f.key);
    for (const key of ['kyc.document_retention_days', 'kyc.legal_hold_days', 'kyc.redact_exports', 'kyc.allow_reseller_review']) {
      expect(keys, `missing ${key}`).toContain(key);
    }
    const values = await request.get('/api/settings', { headers });
    expect(values.ok()).toBeTruthy();
    expect((await values.json()).data.kyc.document_retention_days).toBe(0);
    expect((await values.json()).data.kyc.allow_reseller_review).toBe(false);
  });

  test('review decisions are staff-only and reject invalid input', async ({ request }) => {
    const adminToken = await loginToken(request, admin);
    const resellerToken = await loginToken(request, reseller);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const queue = await request.get('/api/kyc/queue?limit=5', { headers: adminHeaders });
    expect(queue.ok()).toBeTruthy();
    const doc = ((await queue.json()).data || [])[0];
    // Guards and validation run before document lookup, so a placeholder id is
    // enough when the demo database has no KYC documents.
    const docId = doc?.id || '00000000-0000-0000-0000-000000000000';

    const resellerHeaders = { Authorization: `Bearer ${resellerToken}` };
    const blocked = await request.post(`/api/kyc/documents/${docId}/decision`, {
      headers: resellerHeaders, data: { decision: 'APPROVE' },
    });
    expect(blocked.status(), 'resellers must never review KYC').toBe(403);

    const bad = await request.post(`/api/kyc/documents/${docId}/decision`, {
      headers: adminHeaders, data: { decision: 'NOT_A_DECISION' },
    });
    expect(bad.status()).toBe(400);
    const noReason = await request.post(`/api/kyc/documents/${docId}/decision`, {
      headers: adminHeaders, data: { decision: 'REJECT' },
    });
    expect(noReason.status(), 'reject requires a reason').toBe(400);
  });

  test('redacted CSV export is available to staff and scoped for resellers', async ({ request }) => {
    const token = await loginToken(request, admin);
    const res = await request.get('/api/kyc/export.csv', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(res.headers()['content-security-policy'] ?? '').not.toContain('unsafe-inline');
    const csv = await res.text();
    expect(csv.split('\n')[0]).toContain('document_number_masked');
    expect(csv.split('\n')[0]).not.toContain('document_number,');
    for (const line of csv.split('\n').slice(1)) {
      expect(line).not.toMatch(/\b\d{10,}\b/); // raw NID-sized numbers are never exported
    }

    const partnerToken = await loginToken(request, reseller);
    const scoped = await request.get('/api/kyc/export.csv', { headers: { Authorization: `Bearer ${partnerToken}` } });
    expect(scoped.ok()).toBeTruthy();
    const rows = (await scoped.text()).split('\n').slice(1).filter(Boolean);
    const queue = await request.get('/api/kyc/queue?limit=100', { headers: { Authorization: `Bearer ${partnerToken}` } });
    expect((await queue.json()).data.length).toBe(rows.length);
  });

  test('submission records and legal holds are SUPER_ADMIN/Billing scoped', async ({ request }) => {
    const adminToken = await loginToken(request, admin);
    const resellerToken = await loginToken(request, reseller);
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const submissions = await request.get('/api/compliance/submissions', { headers: auth(adminToken) });
    expect(submissions.ok()).toBeTruthy();
    expect((await submissions.json()).data).toBeInstanceOf(Array);
    expect((await request.get('/api/compliance/submissions', { headers: auth(resellerToken) })).status()).toBe(403);
    expect((await request.post('/api/kyc/legal-holds', { headers: auth(resellerToken), data: {
      case_reference: 'x', authority: 'x', requested_by: 'x', subscriber_id: '00000000-0000-0000-0000-000000000000',
    } })).status()).toBe(403);
    const invalidHold = await request.post('/api/kyc/legal-holds', { headers: auth(adminToken), data: { authority: 'only-authority' } });
    expect(invalidHold.status()).toBe(400);
  });
});

test.describe('KYC compliance UI', () => {
  test('reviewer queue renders summary, filters and compliance panels', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`api ${r.status()}: ${r.url()}`); });
    await login(page, admin);
    await page.goto('/kyc-review');
    await expect(page.getByRole('heading', { name: /KYC Review Queue/ })).toBeVisible();
    await expect(page.getByTestId('kyc-queue-table')).toBeVisible();
    await expect(page.getByTestId('kyc-export')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Legal hold' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'BTRC submission evidence' })).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('KYC settings tab and audit deep link are reachable', async ({ page }) => {
    await login(page, admin);
    await page.goto('/settings?tab=kyc');
    await expect(page.getByRole('button', { name: 'KYC & Compliance' })).toBeVisible();
    await expect(page.getByText('Document retention (days, 0=manual)')).toBeVisible();

    await page.goto('/audit?entity_type=kyc_document');
    await expect(page.locator('.filter-chip.active')).toContainText('KYC');
  });

  test('reseller users view shows read-only KYC status', async ({ page }) => {
    await login(page, reseller);
    await page.goto('/resellers?tab=users');
    await expect(page.getByTestId('reseller-kyc-status')).toBeVisible();
    await expect(page.getByText(/Resellers can upload documents but cannot approve or reject identity/)).toBeVisible();
  });
});

test.describe('KYC upload hardening (opt-in)', () => {
  test.skip(!process.env.E2E_MUTATIONS, 'set E2E_MUTATIONS=1 to run KYC upload checks');

  test('mismatched file content and invalid decisions are rejected', async ({ request }) => {
    const token = await loginToken(request, admin);
    const headers = { Authorization: `Bearer ${token}` };
    const list = await request.get('/api/subscribers?limit=1', { headers });
    const target = ((await list.json()).data || [])[0];
    test.skip(!target, 'no subscriber available for upload validation');

    const bad = await request.post(`/api/subscribers/${target.id}/kyc`, {
      headers,
      multipart: {
        file: { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf') },
        doc_type: 'NID',
      },
    });
    expect(bad.status(), 'magic-byte validation must reject mislabelled files').toBe(400);

    const badLink = await request.post(`/api/subscribers/${target.id}/kyc`, {
      headers,
      multipart: {
        file: { name: 'linked.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% bad link\n%%EOF') },
        doc_type: 'NID',
        reupload_of: '00000000-0000-0000-0000-000000000000',
      },
    });
    expect(badLink.status(), 'reupload linkage must reference this subscriber').toBe(400);

    const docs = await request.get(`/api/subscribers/${target.id}/kyc`, { headers });
    const before = ((await docs.json()).data || []).length;
    const good = await request.post(`/api/subscribers/${target.id}/kyc`, {
      headers,
      multipart: {
        file: { name: 'smoke.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% IzanDesk KYC smoke test\n%%EOF') },
        doc_type: 'NID',
        document_number: '1234567890',
      },
    });
    expect(good.ok()).toBeTruthy();
    const created = await good.json();
    expect(created.document_number_masked).toBe('******7890');
    expect(created.checksum).toMatch(/^[a-f0-9]{64}$/);

    const hold = await request.post('/api/kyc/legal-holds', {
      headers,
      data: {
        document_id: created.id, case_reference: 'SMOKE-KYC-1',
        authority: 'Test Authority', requested_by: 'admin', days: 1,
      },
    });
    expect(hold.ok()).toBeTruthy();
    const holdId = (await hold.json()).data.id;
    expect((await request.delete(`/api/subscribers/${target.id}/kyc/${created.id}`, { headers })).status(),
      'active legal hold must block deletion').toBe(409);

    try {
      const after = await request.get(`/api/subscribers/${target.id}/kyc`, { headers });
      expect(((await after.json()).data || []).length).toBe(before + 1);
      const file = await request.get(`/api/subscribers/${target.id}/kyc/${created.id}/file`, { headers });
      expect(file.ok()).toBeTruthy();
      expect(file.headers()['x-content-type-options']).toBe('nosniff');
      expect(file.headers()['content-security-policy']).toBe('sandbox');
    } finally {
      expect((await request.post(`/api/kyc/legal-holds/${holdId}/release`, { headers })).ok()).toBeTruthy();
      const removed = await request.delete(`/api/subscribers/${target.id}/kyc/${created.id}`, { headers });
      expect(removed.ok()).toBeTruthy();
    }
  });
});
