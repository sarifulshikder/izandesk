import { defineConfig } from '@playwright/test';

// The dev stack is already running (Docker with hot reload); these tests never
// start a server themselves. Default to a local stack so an accidental run can
// never mutate a production deployment — point at another host explicitly.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  // This stack runs in Docker on a slow host with on-demand Next dev compiles.
  // Keep generous ceilings so UI actionability waits do not fail before the
  // page finishes rendering; assertions still fail fast on real regressions.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
  },
});
