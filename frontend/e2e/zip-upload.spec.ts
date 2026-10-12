import { expect, test } from '@playwright/test';

const archive = {
  name: 'customer-calls.zip',
  mimeType: 'application/zip',
  buffer: Buffer.from('Условный архив для демо: содержимое не анализируется'),
};

test('заказчик проходит частичный демонстрационный приём до нового батча', async ({ page }) => {
  await page.goto('/demo/customer/batches');
  await page.getByRole('link', { name: 'Загрузить ZIP' }).click();
  await expect(page.getByRole('heading', { name: 'Загрузка ZIP' })).toBeVisible();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('incoming');
  await expect(page.getByRole('main')).toContainText('Выбранный архив не распаковывается');
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archive);
  await page.screenshot({ path: '.scratch/runtime/zip-upload-form-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toContainText(
    'Принято уникальных записей: 2',
  );
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toContainText(
    'Дубликаты: 1',
  );
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toContainText(
    'Ошибки файлов: 1',
  );
  await expect(page.getByRole('main')).toContainText('calls/broken.wav');
  await expect(page.getByRole('main')).toContainText('Ожидает ручного запуска командой Vox AI');
  await expect(page.getByRole('button', { name: 'Поставить в очередь' })).toHaveCount(0);
  await page.screenshot({ path: '.scratch/runtime/zip-upload-desktop.png' });
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  const row = page.getByRole('row').filter({ hasText: 'customer-calls.zip' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Готов к запуску');
  await expect(row).toContainText('Ещё не опубликован');
});

test('повтор после потери подтверждения сохраняет ID, файлы и единственный батч', async ({
  page,
}) => {
  await page.goto('/demo/customer/upload?stream=new-project');
  const id = await page.getByTestId('upload-id').innerText();
  await page.getByText('Демо-сценарии приёма', { exact: true }).click();
  await page.getByLabel('Потерять подтверждение после приёма').check();
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archive);
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Подтверждение приёма не получено');
  await expect(page.getByTestId('upload-id')).toHaveText(id);
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить приём' }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toBeVisible();
  await expect(page.getByTestId('upload-id')).toHaveText(id);
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  await expect(page.getByRole('row').filter({ hasText: archive.name })).toHaveCount(1);
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('new-project');
});

test('ноль принятых записей показывает ошибки и не делает батч готовым', async ({ page }) => {
  await page.goto('/demo/customer/upload?stream=new-project');
  await page.getByText('Демо-сценарии приёма', { exact: true }).click();
  await page.getByLabel('Результат имитации').selectOption('empty');
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archive);
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  const result = page.getByRole('region', { name: 'Результаты приёма' });
  await expect(result).toContainText('Принято уникальных записей: 0');
  await expect(result).toContainText('Дубликаты: 0');
  await expect(result).toContainText('Ошибки файлов: 2');
  await expect(result).toContainText('Батч не готов к запуску');
  await expect(result).not.toContainText('Ожидает ручного запуска');
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  await expect(page.getByRole('row').filter({ hasText: archive.name })).toContainText(
    'Ошибка загрузки',
  );
});

test('независимые загрузки одинакового ZIP получают разные ID и батчи', async ({ page }) => {
  await page.goto('/demo/customer/upload?stream=new-project');
  const first = await page.getByTestId('upload-id').innerText();
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archive);
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить ещё ZIP' }).click();
  await expect(page.getByTestId('upload-id')).not.toHaveText(first);
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Стрим', { exact: true })).toBeFocused();
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archive);
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toBeVisible();
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  await expect(page.getByRole('row').filter({ hasText: archive.name })).toHaveCount(2);
});

test('новая загрузка после ошибки очищает ZIP; поля метаданных нет', async ({ page }) => {
  await page.goto('/demo/customer/upload');
  await expect(page.getByLabel('JSON-метаданные (необязательно)', { exact: true })).toHaveCount(0);
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archive);
  await page.getByText('Демо-сценарии приёма', { exact: true }).click();
  await page.getByLabel('Потерять подтверждение после приёма').check();
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const first = await page.getByTestId('upload-id').innerText();
  await page.getByRole('button', { name: 'Начать новую загрузку' }).click();
  await expect(page.getByTestId('upload-id')).not.toHaveText(first);
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveValue('');
});

test('полный приём без метаданных остаётся локальным и сохраняет выбранный стрим', async ({
  page,
  baseURL,
}) => {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL + '/')) remoteRequests.push(request.url());
  });
  await page.goto('/demo/customer/batches');
  await page.getByLabel('Стрим', { exact: true }).selectOption('outgoing');
  await page.getByRole('link', { name: 'Загрузить ZIP' }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('outgoing');
  await page.getByText('Демо-сценарии приёма', { exact: true }).click();
  await page.getByLabel('Результат имитации').selectOption('success');
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archive);
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  const result = page.getByRole('region', { name: 'Результаты приёма' });
  await expect(result).toContainText('Принято уникальных записей: 2');
  await expect(result).toContainText('Дубликаты: 0');
  await expect(result).toContainText('Ошибки файлов: 0');
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('outgoing');
  await expect(page.getByRole('row').filter({ hasText: archive.name })).toContainText(
    'Готов к запуску',
  );
  expect(remoteRequests).toEqual([]);
});

test('на узком экране форма доступна с клавиатуры и не выходит за экран', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/customer/upload');
  await expect(page.getByRole('heading', { name: 'Загрузка ZIP' })).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'К списку батчей' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Стрим', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const zip = page.getByLabel('Загрузить ZIP', { exact: true });
  await expect(zip).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles(archive);
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Результаты демонстрационного приёма' }),
  ).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.scratch/runtime/zip-upload-mobile.png', fullPage: true });
});

test('подстановка чужой организации или стрима не меняет доступный контекст заказчика', async ({
  page,
}) => {
  await page.goto('/demo/customer/upload?organization=support&stream=support-incoming');
  await expect(page.getByRole('banner')).toContainText('Контакт-центр');
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('incoming');
  await expect(page.getByLabel('Стрим', { exact: true }).getByRole('option')).not.toContainText([
    'Поддержка клиентов',
  ]);
  await page.goto('/demo/team/batches');
  await expect(page.getByRole('link', { name: 'Загрузить ZIP' })).toHaveCount(0);
});
