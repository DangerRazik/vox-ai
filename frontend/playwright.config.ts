import { defineConfig, devices } from '@playwright/test';

const port = process.env['PLAYWRIGHT_PORT'] ?? '4200';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    channel: process.env['PLAYWRIGHT_CHANNEL'],
    trace: 'retain-on-failure',
    actionTimeout: 5_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run start:frontend -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
