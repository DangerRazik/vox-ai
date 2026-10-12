import { expect, test } from '@playwright/test';

test('частичная загрузка сохраняет ошибки приёма в опубликованном отчёте и сравнении', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  await page.getByRole('link', { name: 'Загрузить ZIP' }).click();
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'partial-queue.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('demo'),
  });
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toContainText(
    'Ошибки файлов: 1',
  );
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  const row = page.getByRole('row').filter({ hasText: 'partial-queue.zip' });
  await row.getByRole('button', { name: /^Поставить в очередь/ }).click();
  await expect(row).toContainText('В очереди');
  const queue = page.getByRole('region', { name: 'Общая очередь батчей' });
  await queue.getByText('Демо-сценарии очереди', { exact: true }).click();
  const advance = queue.getByRole('button', { name: 'Имитировать следующий шаг очереди' });
  await advance.click();
  await expect(queue.getByRole('region', { name: 'Обрабатываемый батч' })).toContainText(
    'Исходящие 06.10',
  );
  await advance.click();
  await expect(queue.getByRole('region', { name: 'Обрабатываемый батч' })).toContainText(
    'partial-queue.zip',
  );
  await advance.click();
  await expect(row).toContainText('Завершён');
  await row.getByRole('link', { name: /^Отчёт/ }).click();
  await expect(page.getByRole('region', { name: 'Ошибки батча' })).toContainText(
    'Ошибки загрузки: 1',
  );
  await expect(page.getByRole('region', { name: 'Успешно обработано', exact: true })).toContainText(
    '2 из 2',
  );
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Сравнение', exact: true }).click();
  await page.getByRole('checkbox', { name: /partial-queue.zip/ }).check();
  await page.getByRole('checkbox', { name: /Батч 01.10/ }).check();
  await page.getByRole('button', { name: 'Сравнить выбранные батчи' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'Ошибки загрузки' }).getByRole('cell').nth(0),
  ).toHaveText('1');
});

test('команда вручную ставит готовый батч в общую очередь, оценка остаётся неопубликованной', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Батч 05.10' });
  await row.getByRole('button', { name: /^Поставить в очередь/ }).click();
  await expect(row).toContainText('В очереди');
  await expect(row).toContainText('Ещё не опубликован');
  await expect(row.getByRole('button')).toHaveCount(0);
  const queue = page.getByRole('region', { name: 'Общая очередь батчей' });
  await expect(queue.getByRole('listitem')).toHaveCount(2);
  await expect(queue.getByRole('listitem').nth(0)).toContainText('Исходящие 06.10');
  await expect(queue.getByRole('listitem').nth(1)).toContainText('Батч 05.10');
  await expect(queue).toContainText('Контакт-центр');
  await expect(queue).toContainText('Батч 06.10');
  await page.screenshot({ path: '.scratch/runtime/admin-queue-desktop.png', fullPage: true });
});

test('режим заказчика не получает запуск и управление очередью даже по административному адресу', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  await page.goto('/demo/team/batches');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('button', { name: /Поставить в очередь|следующий шаг/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole('region', { name: 'Общая очередь батчей' })).toHaveCount(0);
  await page.goto('/demo/team/batches/batch-05/state');
  await expect(page.getByRole('region', { name: 'Сведения о батче' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Поставить в очередь/ })).toHaveCount(0);
  await expect(page.getByText('Демо-сценарий повторного запуска', { exact: true })).toHaveCount(0);
});

test('сбой до запуска сохраняет готовность; повтор отправляет один батч', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  const queue = page.getByRole('region', { name: 'Общая очередь батчей' });
  await expect(queue.getByRole('listitem')).toHaveCount(1);
  await queue.getByText('Демо-сценарии очереди', { exact: true }).click();
  await queue.getByRole('button', { name: 'Сбой следующего запуска' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Батч 05.10' });
  await row.getByRole('button', { name: /^Поставить в очередь/ }).click();
  await expect(row.getByRole('alert')).toBeVisible();
  await expect(row).toContainText('Готов к запуску');
  await expect(queue.getByRole('listitem')).toHaveCount(1);
  await row.getByRole('button', { name: /^Повторить постановку/ }).click();
  await expect(row).toContainText('В очереди');
  await expect(queue.getByRole('listitem')).toHaveCount(2);
});

test('удаление стрима убирает его ожидающее задание, остальные продолжаются', async ({ page }) => {
  await page.goto('/demo/customer/upload?stream=new-project');
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'queued-delete.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('demo'),
  });
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toBeVisible();
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByLabel('Стрим', { exact: true }).selectOption('new-project');
  const row = page.getByRole('row').filter({ hasText: 'queued-delete.zip' });
  await row.getByRole('button', { name: /^Поставить в очередь/ }).click();
  await expect(row).toContainText('В очереди');
  const queue = page.getByRole('region', { name: 'Общая очередь батчей' });
  await expect(queue.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await page
    .getByRole('article')
    .filter({ hasText: 'Новый проект' })
    .getByRole('link', { name: 'Просмотреть стрим' })
    .click();
  await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить стрим и историю' }).click();
  await expect(page.getByRole('heading', { name: 'Стрим удалён', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Батчи', exact: true }).click();
  await expect(queue.getByRole('listitem')).toHaveCount(1);
  await expect(queue).not.toContainText('queued-delete.zip');
  await queue.getByText('Демо-сценарии очереди', { exact: true }).click();
  await queue.getByRole('button', { name: 'Имитировать следующий шаг очереди' }).click();
  await expect(queue.getByRole('region', { name: 'Обрабатываемый батч' })).toContainText(
    'Исходящие 06.10',
  );
  await queue.getByRole('button', { name: 'Имитировать следующий шаг очереди' }).click();
  await expect(queue).toContainText('Очередь пуста');
  await expect(queue).toContainText('Сейчас нет обрабатываемого батча');
});

test('узкий экран: запуск с клавиатуры и очередь остаются локальным демо; заказчик не видит управление', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: 'Батч 05.10' })
    .getByRole('link', { name: /^Статус/ })
    .click();
  const start = page.getByRole('button', { name: /^Поставить в очередь/ });
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Сведения о батче' })).toContainText('В очереди');
  await expect(page.getByRole('status')).toContainText('Контакт-центр');
  await page.getByRole('link', { name: 'К списку батчей', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Общая очередь батчей' });
  await expect(queue.getByRole('listitem')).toHaveCount(2);
  await queue.getByText('Демо-сценарии очереди', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.scratch/runtime/admin-queue-mobile.png', fullPage: true });
  expect(external).toEqual([]);
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  await expect(page.getByRole('button', { name: /Поставить в очередь|следующий шаг/ })).toHaveCount(
    0,
  );
  await expect(queue).toHaveCount(0);
});

test('ошибка чтения общей очереди не теряет порядок и исправляется повтором', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  const queue = page.getByRole('region', { name: 'Общая очередь батчей' });
  await expect(queue.getByRole('listitem')).toHaveCount(1);
  await queue.getByText('Демо-сценарии очереди', { exact: true }).click();
  await queue.getByRole('button', { name: 'Показать ошибку чтения очереди' }).click();
  await expect(queue.getByRole('alert')).toContainText('Не удалось прочитать очередь');
  await expect(queue.getByRole('listitem')).toHaveCount(0);
  await queue.getByRole('button', { name: 'Повторить чтение очереди' }).click();
  await expect(queue.getByRole('listitem')).toHaveCount(1);
  await expect(queue.getByRole('listitem')).toContainText('Исходящие 06.10');
});

test('восстановленный батч и батч другой организации обрабатываются последовательно по FIFO', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches/batch-03/state');
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'original.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('demo'),
  });
  await page.getByRole('button', { name: 'Имитировать восстановление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Восстановление завершено' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Поставить в очередь/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  const restored = page.getByRole('row').filter({ hasText: 'Батч 03.10' });
  await restored.getByRole('button', { name: /^Поставить в очередь/ }).click();
  await expect(restored).toContainText('В очереди');
  await page.getByLabel('Организация', { exact: true }).selectOption('support');
  const support = page.getByRole('row').filter({ hasText: 'Поддержка 05.10' });
  await support.getByRole('button', { name: /^Поставить в очередь/ }).click();
  await expect(support).toContainText('В очереди');
  const queue = page.getByRole('region', { name: 'Общая очередь батчей' });
  await expect(queue.getByRole('listitem')).toHaveCount(3);
  await expect(queue.getByRole('listitem').nth(1)).toContainText('Батч 03.10');
  await expect(queue.getByRole('listitem').nth(2)).toContainText('Поддержка 05.10');
  await queue.getByText('Демо-сценарии очереди', { exact: true }).click();
  const advance = queue.getByRole('button', { name: 'Имитировать следующий шаг очереди' });
  for (const activeName of ['Исходящие 06.10', 'Батч 03.10', 'Поддержка 05.10']) {
    await advance.click();
    await expect(queue.getByRole('region', { name: 'Обрабатываемый батч' })).toContainText(
      activeName,
    );
    await expect(queue.getByRole('region', { name: 'Обрабатываемый батч' })).toHaveCount(1);
  }
  await advance.click();
  await expect(queue).toContainText('Сейчас нет обрабатываемого батча');
  await expect(queue).toContainText('Очередь пуста');
  await expect(support).toContainText('Завершён');
  await support.getByRole('link', { name: /^Отчёт/ }).click();
  await expect(page.getByRole('banner')).toContainText('Сервис поддержки');
  await expect(page.getByRole('region', { name: 'Успешно обработано', exact: true })).toContainText(
    '3 из 3',
  );
  await expect(page.getByRole('region', { name: 'Средняя оценка', exact: true })).toContainText(
    '10 из 11',
  );
  await page.getByRole('link', { name: 'call_001.mp3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор звонка' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Поддержка 05.10');
  await page.getByRole('navigation').getByRole('link', { name: 'Батчи', exact: true }).click();
  await page.getByLabel('Организация', { exact: true }).selectOption('contact-center');
  await page
    .getByRole('row')
    .filter({ hasText: 'Батч 03.10' })
    .getByRole('link', { name: /^Отчёт/ })
    .click();
  await expect(page.getByRole('region', { name: 'Успешно обработано', exact: true })).toContainText(
    '120 из 120',
  );
});

for (const [id, state] of [
  ['outgoing-06', 'В очереди'],
  ['batch-06', 'Обрабатывается'],
  ['batch-04', 'Завершён'],
]) {
  test(`повтор запущенного батча возвращает прежнее состояние: ${state}`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Открыть демо команды' }).click();
    await page.goto(`/demo/team/batches/${id}/state`);
    await page.getByText('Демо-сценарий повторного запуска', { exact: true }).click();
    await page.getByRole('button', { name: /^Повторить запрос запуска/ }).click();
    await expect(page.getByRole('status')).toContainText('повтор не создаёт новое задание');
    await expect(page.getByRole('region', { name: 'Сведения о батче' })).toContainText(state);
    await page.getByRole('link', { name: 'К списку батчей', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Общая очередь батчей' });
    await expect(queue.getByRole('listitem')).toHaveCount(1);
    await expect(queue.getByRole('region', { name: 'Обрабатываемый батч' })).toContainText(
      'Батч 06.10',
    );
  });
}

for (const id of ['outgoing-04', 'outgoing-05', 'batch-03']) {
  test(`незавершённый или ошибочный батч не запускается: ${id}`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Открыть демо команды' }).click();
    await page.goto(`/demo/team/batches/${id}/state`);
    await expect(page.getByRole('region', { name: 'Сведения о батче' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Поставить в очередь/ })).toHaveCount(0);
    await page.getByText('Демо-сценарий повторного запуска', { exact: true }).click();
    await page.getByRole('button', { name: /^Повторить запрос запуска/ }).click();
    await expect(page.getByRole('alert')).toContainText('запуск отклонён');
    await page.getByRole('link', { name: 'К списку батчей', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Общая очередь батчей' }).getByRole('listitem'),
    ).toHaveCount(1);
  });
}

test('потеря подтверждения запуска допускает повтор с тем же ID без второго задания', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByText('Демо-сценарии очереди', { exact: true }).click();
  await page.getByRole('button', { name: 'Потерять подтверждение следующего запуска' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Батч 05.10' });
  await row.getByRole('button', { name: /^Поставить в очередь/ }).click();
  await expect(row.getByRole('alert')).toContainText('Подтверждение запуска не получено');
  await row.getByRole('button', { name: /^Повторить постановку/ }).click();
  await expect(row).toContainText('В очереди');
  const queue = page.getByRole('region', { name: 'Общая очередь батчей' });
  await expect(queue.getByRole('listitem')).toHaveCount(2);
  await expect(queue.getByRole('listitem').filter({ hasText: 'Батч 05.10' })).toHaveCount(1);
  await row.getByRole('link', { name: /^Статус/ }).click();
  await expect(page.getByTestId('batch-id')).toHaveText('batch-05');
});
