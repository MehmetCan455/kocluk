import { defineConfig } from '@playwright/test';

// The E2E stack is the local mock API + Vite dev server. Dedicated ports keep
// it separate from the manual preview (`npm run mock:api` + `npm run dev` on
// 8787/5173) so both can run at the same time. `VITE_API_PROXY_TARGET` only
// changes the dev proxy target; production keeps the same-origin `/api` path.
const APP_PORT = 4173;
const API_PORT = 8788;
const BASE_URL = `http://localhost:${APP_PORT}/`;
const API_URL = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run mock:api',
      url: `${API_URL}/api/health`,
      // Never reuse a manually started server: the suite resets data and must
      // not wipe the local preview's JSON file.
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        MOCK_API_HOST: '127.0.0.1',
        MOCK_API_PORT: String(API_PORT),
        MOCK_API_DATA_FILE: 'scripts/mock-api-e2e-data.json',
      },
    },
    {
      command: `npm run dev -- --port ${APP_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_PROXY_TARGET: API_URL,
      },
    },
  ],
});
