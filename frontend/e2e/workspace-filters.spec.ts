import { expect, test } from '@playwright/test';

test('панель фильтров компактна; статусы обновляются без перезагрузки и фильтры сохраняются', async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({ json: { role: 'admin', customer: null } }),
  );
  await page.route('**/api/v1/admin/customers', (r) =>
    r.fulfill({ json: { items: [{ customer_id: 'o1', name: 'Контакт-центр' }] } }),
  );
  await page.route('**/api/v1/streams?*', (r) =>
    r.fulfill({
      json: {
        items: [
          {
            stream_id: 'f09f5e02-3fa1-4f22-9bb2-01b46baf1435',
            customer_id: 'o1',
            name: 'Входящие обращения',
            created_at: '2026-10-01T00:00:00Z',
            criteria: [],
            options: {
              speech_rate_enabled: true,
              unwanted_expressions_enabled: false,
              text_correction_enabled: false,
              zero_total_on_critical: true,
            },
          },
        ],
      },
    }),
  );
  let status = 'processing';
  let requests = 0;
  let reject = false;
  await page.route('**/api/v1/batches?*', (r) => {
    requests++;
    return reject
      ? r.fulfill({ status: 503, json: {} })
      : r.fulfill({
          json: {
            items: [
              {
                batch_id: 'b1',
                customer_id: 'o1',
                stream_id: 'f09f5e02-3fa1-4f22-9bb2-01b46baf1435',
                upload_id: 'morning',
                status,
                total_calls: 4,
                created_at: '2026-10-08T00:00:00Z',
              },
            ],
          },
        });
  });
  await page.route('**/api/v1/streams/*/dashboard', (r) =>
    r.fulfill({ json: { items: [{ batch_id: 'b1', average_total: 9.5 }] } }),
  );
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('test-admin');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Обрабатывается');
  await expect(page.getByRole('button', { name: 'Обновить список' })).toHaveCount(0);
  await page.getByLabel('Статус', { exact: true }).selectOption('processing');
  const panel = page.getByRole('region', { name: 'Фильтры списка' });
  await expect(panel.getByLabel('Стрим', { exact: true }).locator('option:checked')).toHaveText(
    'Входящие обращения',
  );
  const owner = await panel.getByLabel('Заказчик', { exact: true }).boundingBox();
  const stream = await panel.getByLabel('Стрим', { exact: true }).boundingBox();
  const filter = await panel.getByLabel('Статус', { exact: true }).boundingBox();
  expect(Math.abs(owner!.y - stream!.y)).toBeLessThan(1);
  expect(Math.abs(filter!.y - stream!.y)).toBeLessThan(1);
  expect(Math.abs(stream!.width - owner!.width)).toBeLessThan(1);
  expect(Math.abs(filter!.width - owner!.width)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath('filters-desktop.png'), fullPage: true });
  status = 'completed';
  await page.clock.fastForward(10_000);
  await expect(page.getByRole('heading', { name: 'Батчи не найдены' })).toBeVisible();
  await expect(page.getByLabel('Статус', { exact: true })).toHaveValue('processing');
  await expect(page.getByLabel('Заказчик', { exact: true })).toHaveValue('o1');
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue(
    'f09f5e02-3fa1-4f22-9bb2-01b46baf1435',
  );
  await page.getByLabel('Статус', { exact: true }).selectOption('');
  await expect(page.getByRole('table')).toContainText('Завершён');
  await expect(page.getByRole('table')).toContainText('9,5 из 11');
  await page.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }),
  );
  const count = requests;
  await page.clock.fastForward(30_000);
  expect(requests).toBe(count);
  await page.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }),
  );
  reject = true;
  await page.clock.fastForward(10_000);
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить данные');
  reject = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Завершён');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOwner = await panel.getByLabel('Заказчик', { exact: true }).boundingBox();
  const mobileStream = await panel.getByLabel('Стрим', { exact: true }).boundingBox();
  const mobileStatus = await panel.getByLabel('Статус', { exact: true }).boundingBox();
  expect(mobileOwner!.y + mobileOwner!.height).toBeLessThan(mobileStream!.y);
  expect(mobileStream!.y + mobileStream!.height).toBeLessThan(mobileStatus!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await panel.getByLabel('Заказчик', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(panel.getByLabel('Стрим', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByLabel('Статус', { exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('filters-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  const atExit = requests;
  await page.clock.fastForward(30_000);
  expect(requests).toBe(atExit);
});

test('в списке заказчика видны имена стримов, увеличенная кнопка ZIP и меньший отступ', async ({
  page,
}, testInfo) => {
  const streamId = 'f09f5e02-3fa1-4f22-9bb2-01b46baf1435';
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({
      json: {
        role: 'customer',
        customer: { customer_id: 'o1', name: 'Контакт-центр' },
      },
    }),
  );
  await page.route('**/api/v1/streams?*', (r) =>
    r.fulfill({
      json: {
        items: [
          {
            stream_id: streamId,
            customer_id: 'o1',
            name: 'Входящие обращения',
            created_at: '2026-10-01T00:00:00Z',
            criteria: [],
            options: {},
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/batches?*', (r) => r.fulfill({ json: { items: [] } }));
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('test-customer');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Фильтры списка' });
  const stream = panel.getByLabel('Стрим', { exact: true });
  await expect(stream.locator('option:checked')).toHaveText('Входящие обращения');
  await expect(stream).toHaveValue(streamId);
  const upload = page.getByRole('link', { name: 'Загрузить ZIP', exact: true });
  const buttonBox = (await upload.boundingBox())!;
  expect(buttonBox.height).toBeGreaterThanOrEqual(48);
  expect(buttonBox.width).toBeGreaterThanOrEqual(156);
  const heading = (await page.locator('.page-heading').boundingBox())!;
  const filters = (await panel.boundingBox())!;
  expect(filters.y - heading.y - heading.height).toBeGreaterThanOrEqual(24);
  expect(filters.y - heading.y - heading.height).toBeLessThanOrEqual(28);
  await page.screenshot({
    path: testInfo.outputPath('customer-batches-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(upload).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('customer-batches-mobile.png'),
    fullPage: true,
  });
  await upload.click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue(streamId);
});
