import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:18080',
    channel: process.env['PLAYWRIGHT_CHANNEL'],
    trace: 'off',
    screenshot: 'off',
  },
});
