import { defineConfig } from '@playwright/test';

// The dev stack is already running (Docker with hot reload); these tests never
// start a server themselves. Default to a local stack so an accidental run can
// never mutate a production deployment — point at another host explicitly.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

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
