import { defineConfig } from '@playwright/test';

// The dev stack is already running (Docker with hot reload); these tests never
// start a server themselves. Override with E2E_BASE_URL to target another host.
const baseURL = process.env.E2E_BASE_URL || 'https://izandesk.duckdns.org';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
  },
});
