import { expect, test } from '@playwright/test';

test('прогресс автоматически обновляется, переживает сбой чтения и завершает батч', async ({
  page,
}) => {
  await page.clock.install();
  let status = 'queued';
  let processed = 0;
  let fail = false;
  let pauseRequested = false;
  let paused = false;
  const batch = () => ({
    batch_id: 'b1',
    customer_id: 'o1',
    stream_id: 's1',
    upload_id: 'u1',
    created_at: '2026-10-13T09:00:00Z',
    status,
    total_calls: 10,
    error: null,
    processing_progress: {
      processed_calls: processed,
      total_calls: 10,
      pause_requested: pauseRequested,
      paused,
    },
  });
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({ json: { role: 'admin', customer: null } }),
  );
  await page.route('**/api/v1/admin/customers', (r) =>
    r.fulfill({ json: { items: [{ customer_id: 'o1', name: 'Организация' }] } }),
  );
  await page.route('**/api/v1/customers/o1', (r) =>
    r.fulfill({ json: { customer_id: 'o1', name: 'Организация' } }),
  );
  await page.route('**/api/v1/streams?*', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/streams/s1', (r) =>
    r.fulfill({ json: { stream_id: 's1', customer_id: 'o1', name: 'Стрим' } }),
  );
  await page.route('**/api/v1/batches?*', (r) => r.fulfill({ json: { items: [batch()] } }));
  await page.route('**/api/v1/batches/b1/files', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/batches/b1', (r) =>
    fail ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: batch() }),
  );
  await page.route('**/api/v1/admin/batches/b1/pause', (r) => {
    pauseRequested = true;
    return r.fulfill({ json: batch() });
  });
  await page.route('**/api/v1/admin/batches/b1/resume', (r) => {
    pauseRequested = false;
    paused = false;
    return r.fulfill({ json: batch() });
  });
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('progress-admin');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await page.waitForURL(/team\/batches/);
  await page.goto('/team/batches/b1/state');
  const progress = page.getByRole('region', { name: 'Прогресс обработки', exact: true });
  await expect(progress).toContainText('В очереди');
  status = 'processing';
  processed = 6;
  await page.clock.fastForward(5000);
  await expect(progress.getByRole('progressbar')).toHaveAttribute('value', '60');
  await expect(progress).toContainText('Обработано 6 из 10');
  await page.screenshot({
    path: '.scratch/runtime/batch-progress-processing.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({
    path: '.scratch/runtime/batch-progress-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 720 });

  await progress.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(progress).toContainText('Ожидаем завершения текущего звонка для паузы');
  paused = true;
  await page.clock.fastForward(5000);
  await expect(progress).toContainText('На паузе');
  await expect(progress.getByRole('progressbar')).toHaveAttribute('value', '60');
  fail = true;
  await page.clock.fastForward(5000);
  await expect(progress).toContainText('Не удалось обновить прогресс');
  await expect(progress.getByRole('progressbar')).toHaveAttribute('value', '60');
  fail = false;
  await progress.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(progress).toContainText('Обработка звонков');
  status = 'completed';
  processed = 10;
  await page.clock.fastForward(5000);
  await expect(progress.getByRole('progressbar')).toHaveAttribute('value', '100');
  await expect(page.getByRole('link', { name: 'Открыть отчёт', exact: true })).toBeVisible();
  await page.screenshot({ path: '.scratch/runtime/batch-progress-completed.png', fullPage: true });
});
