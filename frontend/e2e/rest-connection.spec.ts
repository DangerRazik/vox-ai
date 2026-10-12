import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const criteria = ['1.1', '1.2', '2.1', '2.2', '2.3', '2.4', '3.1', '3.2', '4.1', '5.1', '5.2'].map(
  (id) => ({ id, title: `Критерий ${id}` }),
);
const stream = (owner = 'org-a', id = 'stream-a') => ({
  stream_id: id,
  customer_id: owner,
  name: `Рабочий стрим ${id}`,
  created_at: '2026-10-01T00:00:00Z',
  options: {
    speech_rate_enabled: true,
    unwanted_expressions_enabled: false,
    text_correction_enabled: false,
    zero_total_on_critical: true,
  },
  criteria,
});
async function login(page: Page, key = 'browser-secret') {
  await page.goto('/connect');
  await expect(page.getByLabel('Адрес API', { exact: true })).toHaveCount(0);
  await page.getByLabel('API-ключ', { exact: true }).fill(key);
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
}

test('рабочий вход читает списки, сохраняет ключ и выходит без демонстрационных данных', async ({
  page,
}) => {
  await page.route('**/api/v1/access-context', (route) =>
    route.fulfill({
      json: {
        role: 'customer',
        customer: { customer_id: 'org-a', name: 'Настоящий заказчик' },
      },
    }),
  );
  await page.route('**/api/v1/streams?**', (route) =>
    route.fulfill({ json: { items: [stream()] } }),
  );
  await page.route('**/api/v1/batches?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            batch_id: 'batch-a',
            customer_id: 'org-a',
            stream_id: 'stream-a',
            upload_id: 'upload-a',
            status: 'restoring',
            total_calls: 7,
            created_at: '2026-10-08T00:00:00Z',
          },
        ],
      },
    }),
  );
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('browser-secret');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/batches$/);
  await expect(page.getByRole('table')).toContainText('upload-a');
  await expect(page.getByRole('table')).toContainText('Восстанавливается');
  await expect(page.getByRole('table')).toContainText('7');
  await expect(page.getByText('Ещё не опубликован', { exact: true })).toBeAttached();
  await expect(page.getByText('Демо · условные данные')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('table')).toContainText('upload-a');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL(/\/connect$/);
  expect(await page.evaluate(() => localStorage.getItem('vox-api-connection'))).toBeNull();
  await page.goto('/team/batches');
  await expect(page).toHaveURL(/\/connect$/);
});

test('смена ключа очищает прежнюю организацию; пустой заказчик не получает чужие права', async ({
  page,
}) => {
  await page.route('**/api/v1/access-context', (route) =>
    route.fulfill({
      json: {
        role: 'customer',
        customer: { customer_id: 'org-a', name: 'Заказчик А' },
      },
    }),
  );
  await page.route('**/api/v1/streams?**', (route) => route.fulfill({ json: { items: [] } }));
  await login(page);
  await expect(page.getByRole('status')).toContainText('Пока нет готовых стримов');
  await expect(page.getByRole('button', { name: 'Сменить подключение' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL(/\/connect$/);
  expect(await page.evaluate(() => localStorage.getItem('vox-api-connection'))).toBeNull();
  await page.route('**/api/v1/access-context', (route) => {
    expect(route.request().headers()['authorization']).toBe('Bearer other-secret');
    return route.fulfill({
      json: { role: 'customer', customer: { customer_id: 'org-b', name: 'Заказчик Б' } },
    });
  });
  await page.route('**/api/v1/streams?**', (route) => {
    expect(new URL(route.request().url()).searchParams.get('customer_id')).toBe('org-b');
    return route.fulfill({ json: { items: [] } });
  });
  await page.getByLabel('API-ключ', { exact: true }).fill('other-secret');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('banner')).toContainText('Заказчик Б');
  await expect(page.locator('body')).not.toContainText('Заказчик А');
  await page.goto('/team/batches?organization=org-a');
  await expect(page).toHaveURL(/\/customer\/batches$/);
  await expect(page.getByRole('banner')).toContainText('Заказчик Б');
  expect(page.url()).not.toContain('other-secret');
});

test('сбой чтения предлагает повтор, а 401 очищает ключ и предлагает переподключиться', async ({
  page,
}) => {
  await page.route('**/api/v1/access-context', (route) =>
    route.fulfill({
      json: {
        role: 'customer',
        customer: { customer_id: 'org-a', name: 'Заказчик А' },
      },
    }),
  );
  let mode = 'error';
  await page.route('**/api/v1/streams?**', (route) =>
    mode === 'ok'
      ? route.fulfill({ json: { items: [] } })
      : route.fulfill({
          status: mode === 'error' ? 503 : 401,
          json: { error: { message: 'browser-secret' } },
        }),
  );
  await login(page);
  await expect(page.getByRole('alert')).toContainText('Повторить');
  await expect(page.getByRole('alert')).not.toContainText('browser-secret');
  expect(await page.evaluate(() => localStorage.getItem('vox-api-connection'))).not.toBeNull();
  mode = 'ok';
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Пока нет готовых стримов');
  mode = 'invalid';
  await page.reload();
  await expect(page).toHaveURL(/\/connect$/);
  await expect(page.getByRole('alert')).toContainText('Ключ отклонён');
  expect(await page.evaluate(() => localStorage.getItem('vox-api-connection'))).toBeNull();
  await expect(page.locator('body')).not.toContainText('Заказчик А');
});

test('публичные опции, фильтр стрима и статуса, опубликованный ноль и Нет данных', async ({
  page,
}) => {
  await page.route('**/api/v1/access-context', (route) =>
    route.fulfill({
      json: {
        role: 'customer',
        customer: { customer_id: 'org-a', name: 'Заказчик А' },
      },
    }),
  );
  await page.route('**/api/v1/streams?**', (route) =>
    route.fulfill({ json: { items: [stream(), stream('org-a', 'stream-b')] } }),
  );
  await page.route('**/api/v1/batches?**', (route) => {
    const sid = new URL(route.request().url()).searchParams.get('stream_id');
    return route.fulfill({
      json: {
        items:
          sid === 'stream-b'
            ? []
            : [
                {
                  batch_id: 'b-zero',
                  customer_id: 'org-a',
                  stream_id: 'stream-a',
                  upload_id: 'published-zero',
                  status: 'completed',
                  total_calls: 1,
                  created_at: '2026-10-08T00:00:00Z',
                },
                {
                  batch_id: 'b-empty',
                  customer_id: 'org-a',
                  stream_id: 'stream-a',
                  upload_id: 'published-empty',
                  status: 'completed',
                  total_calls: 2,
                  created_at: '2026-10-08T00:00:00Z',
                },
                {
                  batch_id: 'b-ready',
                  customer_id: 'org-a',
                  stream_id: 'stream-a',
                  upload_id: 'ready-upload',
                  status: 'ready',
                  total_calls: 3,
                  created_at: '2026-10-08T00:00:00Z',
                },
              ],
      },
    });
  });
  await page.route('**/api/v1/streams/stream-a/dashboard', (route) =>
    route.fulfill({
      json: {
        stream_id: 'stream-a',
        items: [
          { batch_id: 'b-zero', average_total: 0 },
          { batch_id: 'b-empty', average_total: null },
        ],
      },
    }),
  );
  await login(page);
  await expect(page.getByRole('row', { name: /published-zero/ })).toContainText('0 из 11');
  await expect(page.getByRole('row', { name: /published-empty/ })).toContainText('Нет данных');
  await page.getByLabel('Статус', { exact: true }).selectOption('ready');
  await expect(page.getByRole('table')).not.toContainText('published-zero');
  await expect(page.getByRole('table')).toContainText('ready-upload');
  await page.getByLabel('Стрим', { exact: true }).selectOption('stream-b');
  await expect(page.getByRole('status')).toContainText('Батчи не найдены');
  await page.getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Готовые стримы' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Публичные опции' })).toHaveCount(2);
  await page.getByText('Критерии оценки · 11', { exact: true }).first().click();
  await expect(page.locator('details').first().getByRole('listitem')).toHaveCount(11);
  await expect(page.locator('article').first()).toContainText('Анализ темпа речиВключено');
});

test('ключ команды даёт выбор заказчика; поздний ответ прежнего выбора не заменяет текущие данные', async ({
  page,
}) => {
  await page.route('**/api/v1/access-context', (route) =>
    route.fulfill({ json: { role: 'admin', customer: null } }),
  );
  await page.route('**/api/v1/admin/customers', (route) =>
    route.fulfill({
      json: {
        items: [
          { customer_id: 'org-a', name: 'Заказчик А' },
          { customer_id: 'org-b', name: 'Заказчик Б' },
        ],
      },
    }),
  );
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/streams?**', async (route) => {
    const owner = new URL(route.request().url()).searchParams.get('customer_id')!;
    if (owner === 'org-a') await delayed;
    await route
      .fulfill({ json: { items: [stream(owner, owner === 'org-a' ? 'stream-a' : 'stream-b')] } })
      .catch(() => {});
  });
  await page.route('**/api/v1/batches?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/admin/streams/stream-b', (route) =>
    route.fulfill({
      json: {
        ...stream('org-b', 'stream-b'),
        config: {
          name: 'Правила',
          whisper_model: 'whisper-large-v3',
          llm_model: 'kimi-k2.7-code',
          speech_lang: 'ru',
          whisper_prompt: '',
          role_prompt: 'Роли {fragments}',
          analysis_system_prompt: 'Оцени',
          analysis_user_prompt: '{checklist}{kb}{metrics}{dialog}',
          long_pause_sec: 2,
          interruption_gap_sec: 0.2,
          speech_rate_enabled: true,
          unwanted_expressions_enabled: false,
          text_correction_enabled: false,
          zero_total_on_critical: true,
        },
        materials: { knowledge_base: { size_bytes: 12, sha256: 'abc' } },
      },
    }),
  );
  await login(page);
  await expect(page).toHaveURL(/\/team\/batches$/);
  await page.getByLabel('Заказчик', { exact: true }).selectOption('org-b');
  await expect(page.getByLabel('Стрим', { exact: true })).toContainText('stream-b');
  release();
  await expect(page.getByLabel('Стрим', { exact: true })).not.toContainText('stream-a');
  await page.getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByRole('banner')).toContainText('Заказчик Б');
  await expect(page.locator('article')).toContainText('stream-b');
});

test('временный отказ контекста на повторном посещении сохраняет подключение для повтора', async ({
  page,
}) => {
  let failed = false;
  await page.route('**/api/v1/access-context', (route) =>
    failed
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: { role: 'customer', customer: { customer_id: 'org-a', name: 'Заказчик А' } },
        }),
  );
  await page.route('**/api/v1/streams?**', (route) => route.fulfill({ json: { items: [] } }));
  await login(page);
  await expect(page.getByRole('status')).toContainText('Пока нет готовых стримов');
  failed = true;
  await page.reload();
  await expect(page).toHaveURL(/\/connect$/);
  await expect(
    page.getByRole('button', { name: 'Повторить сохранённое подключение' }),
  ).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Повторить сохранённое подключение' }).click();
  await expect(page).toHaveURL(/\/customer\/batches$/);
});

test('форма и рабочее меню доступны с клавиатуры на узком экране', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/v1/access-context', (route) =>
    route.fulfill({
      json: {
        role: 'customer',
        customer: { customer_id: 'org-a', name: 'Контакт-центр заказчика А' },
      },
    }),
  );
  await page.route('**/api/v1/streams?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto('/connect');
  await page.getByRole('link', { name: 'Vox AI — главная' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('API-ключ', { exact: true })).toBeFocused();
  await page.keyboard.type('keyboard-secret');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Пока нет готовых стримов');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.getByRole('link', { name: 'Перейти к содержимому' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('rest-mobile.png'), fullPage: true });
});

test('старое подключение к другому адресу не отправляет сохранённый ключ; вход использует API сайта', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/other/v1/')) requests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'vox-api-connection',
      JSON.stringify({
        address: '/other/v1',
        key: 'legacy-secret',
      }),
    );
  });
  await page.route('**/other/v1/**', (r) => r.fulfill({ status: 503 }));
  await page.route('**/api/v1/access-context', (r) => {
    expect(r.request().headers()['authorization']).toBe('Bearer current-key');
    return r.fulfill({
      json: { role: 'customer', customer: { customer_id: 'org-a', name: 'Заказчик А' } },
    });
  });
  await page.route('**/api/v1/streams?**', (r) => r.fulfill({ json: { items: [] } }));
  await login(page, 'current-key');
  await expect(page).toHaveURL(/\/customer\/batches$/);
  await expect(page.getByRole('banner')).toContainText('Заказчик А');
  expect(requests).toEqual([]);
});

test('название загрузки и ссылка на отчёт показывают полный UUID', async ({ page }) => {
  const batchId = 'c12c9b8b-80b8-4705-a00d-8d295ce182eb';
  const uploadId = '144dfcb3-ad4f-47cf-aa7f-44907471fa7d';
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({
      json: {
        role: 'customer',
        customer: { customer_id: 'org-a', name: 'Заказчик А' },
      },
    }),
  );
  await page.route('**/api/v1/streams?*', (r) => r.fulfill({ json: { items: [stream()] } }));
  await page.route('**/api/v1/batches?*', (r) =>
    r.fulfill({
      json: {
        items: [
          {
            batch_id: batchId,
            upload_id: uploadId,
            customer_id: 'org-a',
            stream_id: 'stream-a',
            created_at: '2026-10-09T00:00:00Z',
            status: 'completed',
            total_calls: 4,
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/streams/stream-a/dashboard', (r) =>
    r.fulfill({
      json: {
        items: [{ batch_id: batchId, average_total: 5.88 }],
      },
    }),
  );
  await login(page);
  const row = page.getByRole('row').filter({ hasText: `Загрузка ${uploadId}` });
  await expect(row.locator('.batch-name')).toHaveAttribute('title', uploadId);
  await expect(row.getByRole('link')).toHaveAttribute(
    'href',
    `/customer/batches/${batchId}/report`,
  );
});

test('главная и прежние демонстрационные адреса открывают подключение без условных данных', async ({
  page,
}) => {
  for (const path of ['/', '/demo/customer/batches', '/demo/team/streams']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/connect$/);
    await expect(page.getByLabel('API-ключ', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Открыть демонстрацию' })).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
  }
});
