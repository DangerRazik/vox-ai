import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

test('форма ZIP открывается на HTTP без crypto.randomUUID', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Keep a genuinely insecure browser origin; forward only static files to the local build.
  await page.route('http://vox-http.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/vox/api/v1/')) {
      const body = url.pathname.endsWith('/access-context')
        ? { role: 'customer', customer: { customer_id: 'http-customer', name: 'HTTP test' } }
        : url.pathname.endsWith('/streams')
          ? { items: [{ stream_id: 'http-stream', customer_id: 'http-customer', name: 'HTTP stream',
              created_at: '2026-10-09T00:00:00Z', options: {}, criteria: [] }] }
          : { items: [] };
      await route.fulfill({ json: body });
    } else {
      const response = await route.fetch({ url: `http://127.0.0.1:18080${url.pathname}${url.search}` });
      await route.fulfill({ response });
    }
  });
  await page.goto('http://vox-http.test/vox/connect');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  await page.locator('#api-key').fill('http-test-key');
  await page.locator('form').evaluate(form => form.requestSubmit());
  await expect(page).toHaveURL(/\/vox\/customer\/batches/);
  await page.getByRole('link', { name: 'Загрузить ZIP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Загрузка ZIP', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid=upload-id]')).toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
  );
  await expect(page.locator('#upload-archive')).toBeVisible();
  expect(errors).toEqual([]);
});

test('сборка /vox/: вход, запросы API, маршруты и обновление страницы', async ({ page, request }) => {
  const redirect = await request.get('/vox', { maxRedirects: 0 });
  expect(redirect.status()).toBe(301);
  expect(redirect.headers()['location']).toBe('/vox/');
  // Read the key inside the test process only; never include it in test output or traces.
  const key = execFileSync('docker', [
    'compose', 'exec', '-T', 'api', 'python', '-c',
    "import os; print(os.environ['VOX_ADMIN_API_KEY'], end='')",
  ], { encoding: 'utf8' });
  await page.goto('/vox/connect');
  await expect(page.locator('base')).toHaveAttribute('href', '/vox/');
  await page.locator('#api-key').fill('invalid-docker-smoke-key');
  const denied = page.waitForResponse(r => r.url().endsWith('/vox/api/v1/access-context'));
  await page.locator('form').evaluate(form => form.requestSubmit());
  expect((await denied).status()).toBe(401);
  await expect(page.getByRole('alert')).toContainText('Ключ отклонён');
  await page.locator('#api-key').fill(key);
  const accepted = page.waitForResponse(r => r.url().endsWith('/vox/api/v1/access-context'));
  await page.locator('form').evaluate(form => form.requestSubmit());
  expect((await accepted).status()).toBe(200);
  await expect(page).toHaveURL(/\/vox\/team\//);
  await page.reload();
  await expect(page).toHaveURL(/\/vox\/team\//);
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  const wronglyRooted = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(r => new URL(r.name).pathname).filter(p => p.startsWith('/api/')));
  expect(wronglyRooted).toEqual([]);
});
