import { expect, test } from '@playwright/test';

test('незавершённый батч открывает состояние без оценок и кнопки запуска', async ({ page }) => {
  await page.goto('/demo/customer/batches');
  await page
    .getByRole('row')
    .filter({ hasText: 'Батч 06.10' })
    .getByRole('link', { name: 'Статус' })
    .click();
  await expect(page.getByRole('heading', { name: 'Состояние батча' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Обрабатывается');
  await expect(page.getByRole('main')).toContainText('Принято записей: 300');
  await expect(page.getByRole('main')).toContainText('Отчёт ещё не опубликован');
  await expect(page.getByRole('button', { name: 'Поставить в очередь' })).toHaveCount(0);
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('incoming');
});

for (const [scenario, message] of [
  ['incomplete', 'Повторно переданы не все исходные записи'],
  ['changed', 'В повторной загрузке есть запись вне исходного состава'],
] as const) {
  test(`конфликт ${scenario} сохраняет исходный батч и исправляемый ZIP`, async ({ page }) => {
    await page.goto('/demo/customer/batches/batch-03/state');
    await page.getByText('Демо-сценарии восстановления', { exact: true }).click();
    await page.getByLabel('Состав повторной загрузки').selectOption(scenario);
    await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
      name: 'original.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('demo'),
    });
    await page.getByRole('button', { name: 'Имитировать восстановление', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('region', { name: 'Сведения о батче' })).toContainText(
      'Ошибка батча',
    );
    await expect(page.getByRole('main')).toContainText('Повторно принято: 119 из 120');
    await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveValue(/original.zip$/);
    await expect(page.getByRole('main')).not.toContainText('Восстановление завершено');
    await page.getByLabel('Состав повторной загрузки').selectOption('complete');
    await page.getByRole('button', { name: 'Имитировать восстановление', exact: true }).click();
    await expect(page.getByRole('main')).toContainText('Восстановление завершено');
    await expect(page.getByRole('main')).toContainText('Повторно принято: 120 из 120');
  });
}

test('повтор прерванной передачи сохраняет восстановительный прогресс и не создаёт второй батч', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches/batch-03/state');
  await page.getByText('Демо-сценарии восстановления', { exact: true }).click();
  await page.getByLabel('Прервать передачу после частичного приёма').check();
  const uploadId = await page.getByTestId('upload-id').innerText();
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'original.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('demo'),
  });
  await page.getByRole('button', { name: 'Имитировать восстановление', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Подтверждение повторной загрузки не получено',
  );
  await expect(page.getByRole('main')).toContainText('Повторно принято: 60 из 120');
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveValue(/original.zip$/);
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить передачу', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Восстановление завершено');
  await expect(page.getByRole('main')).toContainText('Повторно принято: 120 из 120');
  await expect(page.getByTestId('upload-id')).toHaveText(uploadId);
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Батч 03.10' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'Батч 03.10' })).toContainText('120');
});

test('повтор первичного импорта исправляет архив в том же батче без требования закрытого состава', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches?stream=outgoing');
  await page
    .getByRole('row')
    .filter({ hasText: 'Исходящие 05.10' })
    .getByRole('link', { name: 'Восстановить' })
    .click();
  await expect(page.getByRole('heading', { name: 'Повтор первичного импорта' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Состав ещё не закрыт');
  const uploadId = await page.getByTestId('upload-id').innerText();
  await page.getByText('Демо-сценарии восстановления', { exact: true }).click();
  await page.getByLabel('Результат повтора импорта').selectOption('failure');
  await page
    .getByLabel('Загрузить ZIP', { exact: true })
    .setInputFiles({ name: 'fixed.zip', mimeType: 'application/zip', buffer: Buffer.from('demo') });
  await page.getByRole('button', { name: 'Имитировать повтор импорта', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось распаковать повторный ZIP');
  await expect(page.getByRole('main')).toContainText('Принято записей: 0');
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveValue(/fixed.zip$/);
  await page.getByLabel('Результат повтора импорта').selectOption('success');
  await page.getByRole('button', { name: 'Имитировать повтор импорта', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Готов к запуску');
  await expect(page.getByRole('main')).toContainText('Принято записей: 2');
  await expect(page.getByTestId('upload-id')).toHaveText(uploadId);
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Исходящие 05.10' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Готов к запуску');
});

test('восстановление возвращает тот же батч и загрузку в ожидание ручного запуска', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches');
  await page
    .getByRole('row')
    .filter({ hasText: 'Батч 03.10' })
    .getByRole('link', { name: 'Восстановить' })
    .click();
  await expect(page.getByRole('main')).toContainText('Сбой сохранения результатов всего батча');
  await expect(page.getByRole('main')).toContainText('Состав проверяется условно');
  const uploadId = await page.getByTestId('upload-id').innerText();
  const batchId = await page.getByTestId('batch-id').innerText();
  await expect(page.getByLabel('Стрим', { exact: true })).toBeDisabled();
  await page.screenshot({ path: '.scratch/runtime/recovery-desktop-form.png', fullPage: true });
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'repacked-original.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('demo'),
  });
  await page.getByRole('button', { name: 'Имитировать восстановление', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Восстановление завершено');
  await expect(page.getByRole('main')).toContainText('Ожидает ручного запуска командой Vox AI');
  await expect(page.getByTestId('upload-id')).toHaveText(uploadId);
  await expect(page.getByTestId('batch-id')).toHaveText(batchId);
  await expect(page.getByRole('main')).toContainText('Повторно принято: 120 из 120');
  await page.screenshot({ path: '.scratch/runtime/recovery-desktop-ready.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Поставить в очередь' })).toHaveCount(0);
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Батч 03.10' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Готов к запуску');
  await expect(row).toContainText('120');
  await expect(row).toContainText('Ещё не опубликован');
});

test('ошибка чтения состояния сохраняет контекст и исправляется повтором', async ({ page }) => {
  await page.goto('/demo/team/batches/outgoing-06/state');
  await expect(page.getByRole('region', { name: 'Сведения о батче' })).toContainText('В очереди');
  await page.getByText('Демо-сценарии состояния', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку состояния', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить состояние');
  await expect(page.getByRole('banner')).toContainText('Контакт-центр');
  await expect(page.getByRole('region', { name: 'Сведения о батче' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Сведения о батче' })).toContainText('В очереди');
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  await expect(page.getByLabel('Организация', { exact: true })).toHaveValue('contact-center');
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('outgoing');
});

test('загрузка, готовность и очередь дают разные объяснения без восстановления', async ({
  page,
}) => {
  for (const [id, label, explanation] of [
    ['outgoing-04', 'Загружается', 'Состав батча пока открыт'],
    ['batch-05', 'Готов к запуску', 'Ожидает ручного запуска командой Vox AI'],
    ['outgoing-06', 'В очереди', 'ожидает начала обработки'],
  ] as const) {
    await page.goto(`/demo/customer/batches/${id}/state`);
    const details = page.getByRole('region', { name: 'Сведения о батче' });
    await expect(details).toContainText(label);
    await expect(details).toContainText(explanation);
    await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Поставить в очередь' })).toHaveCount(0);
  }
});

test('чужой и отсутствующий батчи не раскрывают сведения, а команда читает сбой без клиентской формы', async ({
  page,
}) => {
  for (const id of ['support-06', 'missing']) {
    await page.goto(`/demo/customer/batches/${id}/state`);
    await expect(
      page.getByRole('heading', { name: 'Батч не найден или недоступен' }),
    ).toBeVisible();
    await expect(page.getByTestId('upload-id')).toHaveCount(0);
    await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveCount(0);
  }
  await page.goto('/demo/team/batches/batch-03/state');
  await expect(page.getByRole('region', { name: 'Сведения о батче' })).toContainText(
    'Ошибка батча',
  );
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveCount(0);
});

test('ошибка отдельной записи завершённого батча не разрешает её перезапуск', async ({ page }) => {
  await page.goto('/demo/customer/batches/batch-04/state');
  await expect(page.getByRole('region', { name: 'Сведения о батче' })).toContainText('Завершён');
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Открыть отчёт' }).click();
  await page.getByRole('link', { name: 'call_081.mp3', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Запись не обработана');
  await expect(
    page.getByRole('button', { name: /Перезапустить|Восстановить|Имитировать восстановление/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveCount(0);
});

test('созданный в демо батч после пустого импорта сохраняет исходный ID при повторе', async ({
  page,
}) => {
  await page.goto('/demo/customer/upload?stream=new-project');
  const uploadId = await page.getByTestId('upload-id').innerText();
  await page.getByText('Демо-сценарии приёма', { exact: true }).click();
  await page.getByLabel('Результат имитации').selectOption('empty');
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'empty-intake.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('demo'),
  });
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toContainText(
    'Принято уникальных записей: 0',
  );
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: 'empty-intake.zip' })
    .getByRole('link', { name: 'Восстановить' })
    .click();
  await expect(page.getByTestId('upload-id')).toHaveText(uploadId);
  const batchId = await page.getByTestId('batch-id').innerText();
  await page
    .getByLabel('Загрузить ZIP', { exact: true })
    .setInputFiles({ name: 'fixed.zip', mimeType: 'application/zip', buffer: Buffer.from('demo') });
  await page.getByRole('button', { name: 'Имитировать повтор импорта', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Готов к запуску');
  await expect(page.getByTestId('batch-id')).toHaveText(batchId);
  await expect(page.getByTestId('upload-id')).toHaveText(uploadId);
  await page.getByRole('link', { name: 'К списку батчей' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'empty-intake.zip' })).toHaveCount(1);
});

test('узкий экран позволяет восстановить батч с клавиатуры без внешних запросов', async ({
  page,
  baseURL,
}) => {
  const remote: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL + '/')) remote.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/customer/batches/batch-03/state');
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'К списку батчей' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (
    await chooser
  ).setFiles({ name: 'original.zip', mimeType: 'application/zip', buffer: Buffer.from('demo') });
  await page.screenshot({ path: '.scratch/runtime/recovery-mobile-form.png', fullPage: true });
  await page.getByRole('button', { name: 'Имитировать восстановление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Восстановление завершено' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(remote).toEqual([]);
  await page.screenshot({ path: '.scratch/runtime/recovery-mobile-ready.png', fullPage: true });
});
