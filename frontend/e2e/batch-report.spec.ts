import { expect, test } from '@playwright/test';

test('завершённый батч открывает согласованный отчёт со смешанными исходами', async ({ page }) => {
  await page.goto('/demo/customer/batches');
  await page
    .getByRole('row')
    .filter({ hasText: 'Батч 04.10' })
    .getByRole('link', { name: 'Отчёт' })
    .click();
  await expect(page.getByRole('heading', { name: 'Сводный отчёт' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Стрим incoming');
  await expect(page.getByRole('region', { name: 'Средняя оценка' })).toContainText('9,65 из 11');
  await expect(page.getByRole('region', { name: 'Успешно обработано' })).toContainText('80 из 90');
  await expect(page.getByRole('region', { name: 'Критические нарушения' })).toContainText(
    '2 из 80',
  );
  await expect(page.getByRole('region', { name: 'Ошибки батча' })).toContainText(
    'Ошибки загрузки: 10',
  );
  await expect(page.getByRole('region', { name: 'Ошибки батча' })).toContainText(
    'Ошибки обработки: 10',
  );
  await expect(
    page.getByRole('figure', { name: 'График оценок критериев' }).getByRole('listitem'),
  ).toHaveCount(11);
  await expect(page.getByText('Средние оценки критериев', { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(1);
  const calls = page.getByRole('table', { name: 'Звонки батча' });
  await expect(calls.getByRole('row')).toHaveCount(91);
  await expect(calls.getByRole('row').filter({ hasText: 'call_001.mp3' })).toContainText(
    '9,5 из 11',
  );
  await expect(calls.getByRole('row').filter({ hasText: 'call_002.mp3' })).toContainText('0 из 11');
  await expect(calls.getByRole('row').filter({ hasText: 'call_002.mp3' })).toContainText(
    'Критическое нарушение',
  );
  await expect(calls.getByRole('row').filter({ hasText: 'call_081.mp3' })).toContainText(
    'Нет данных',
  );
  await expect(calls.getByRole('row').filter({ hasText: 'call_081.mp3' })).toContainText(
    'Ошибка транскрибации',
  );
  await expect(
    page
      .getByRole('figure', { name: 'График оценок критериев' })
      .getByRole('listitem')
      .filter({ hasText: 'Критическое нарушение' }),
  ).toContainText('0,98');
  await expect(calls.getByRole('row').filter({ hasText: 'call_002.mp3' })).toContainText(
    'Не указан',
  );
  const totals = await calls
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows
        .filter((row) => row.cells[2].textContent?.includes('из 11'))
        .map((row) => Number(row.cells[2].textContent!.split('из')[0].trim().replace(',', '.'))),
    );
  expect(totals).toHaveLength(80);
  expect(totals.reduce((sum, value) => sum + value, 0)).toBe(772);
  expect(totals.filter((value) => value === 0)).toHaveLength(2);
  await page.screenshot({ path: '.scratch/runtime/batch-report-desktop.png' });
});

test('завершённый батч без успешных звонков сохраняет счётчики и отсутствие данных', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches');
  await page
    .getByRole('row')
    .filter({ hasText: 'Батч 02.10' })
    .getByRole('link', { name: 'Отчёт' })
    .click();
  await expect(page.getByRole('region', { name: 'Средняя оценка' })).toContainText('Нет данных');
  await expect(page.getByRole('region', { name: 'Успешно обработано' })).toContainText('0 из 12');
  await expect(page.getByRole('region', { name: 'Критические нарушения' })).toContainText(
    'Нет данных',
  );
  await expect(page.getByRole('region', { name: 'Ошибки батча' })).toContainText(
    'Ошибки обработки: 12',
  );
  const criteria = page.getByRole('figure', { name: 'График оценок критериев' });
  await expect(criteria.getByText('Нет данных', { exact: true })).toHaveCount(11);
  await expect(page.getByRole('table', { name: 'Звонки батча' }).getByRole('row')).toHaveCount(13);
});

test('до завершения всего батча отчёт недоступен, включая прямой адрес', async ({ page }) => {
  await page.goto('/demo/customer/batches');
  await expect(
    page.getByRole('row').filter({ hasText: 'Батч 06.10' }).getByRole('link', { name: 'Отчёт' }),
  ).toHaveCount(0);
  await page.goto('/demo/customer/batches/batch-06/report');
  await expect(page.getByRole('heading', { name: 'Отчёт ещё недоступен' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Средняя оценка' })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('ошибка отчёта не показывает старые итоги и позволяет повторить чтение', async ({ page }) => {
  await page.goto('/demo/customer/batches/batch-04/report');
  await expect(page.getByRole('heading', { name: 'Сводный отчёт' })).toBeVisible();
  await page.getByText('Демо-сценарии', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку отчёта' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить отчёт');
  await expect(page.getByRole('region', { name: 'Средняя оценка' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Средняя оценка' })).toContainText('9,65 из 11');
});

test('команда читает отчёт выбранной организации и возвращается к её батчам', async ({ page }) => {
  await page.goto('/demo/team/batches');
  await page.getByLabel('Организация', { exact: true }).selectOption('support');
  await page
    .getByRole('row')
    .filter({ hasText: 'Поддержка 06.10' })
    .getByRole('link', { name: 'Отчёт' })
    .click();
  await expect(page.getByRole('banner')).toContainText('Сервис поддержки');
  await expect(page.getByRole('region', { name: 'Успешно обработано' })).toContainText('30 из 30');
  await page.getByRole('link', { name: 'К батчам' }).click();
  await expect(page.getByLabel('Организация', { exact: true })).toHaveValue('support');
  await expect(page.getByRole('row').filter({ hasText: 'Поддержка 06.10' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Батч 04.10' })).toHaveCount(0);
});

test('чужой или отсутствующий отчёт не раскрывает результаты заказчику', async ({ page }) => {
  for (const id of ['support-06', 'missing-batch']) {
    await page.goto(`/demo/customer/batches/${id}/report`);
    await expect(page.getByRole('heading', { name: 'Отчёт не найден' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Средняя оценка' })).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText('Сервис поддержки');
  }
});

test('при ошибке отчёта команды сохраняются организация и возврат к её батчам', async ({
  page,
}) => {
  await page.goto('/demo/team/batches/support-06/report');
  await expect(page.getByRole('heading', { name: 'Сводный отчёт' })).toBeVisible();
  await page.getByText('Демо-сценарии', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку отчёта' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить отчёт');
  await expect(page.getByRole('banner')).toContainText('Сервис поддержки');
  await expect(page.getByRole('region', { name: 'Средняя оценка' })).toHaveCount(0);
  await page.getByRole('link', { name: 'К батчам' }).click();
  await expect(page.getByLabel('Организация', { exact: true })).toHaveValue('support');
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('support-incoming');
  await expect(page.getByRole('row').filter({ hasText: 'Поддержка 06.10' })).toBeVisible();
});

test('на узком экране отчёт открывается с клавиатуры, а таблица прокручивается внутри страницы', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/customer/batches');
  const reportLink = page
    .getByRole('row')
    .filter({ hasText: 'Батч 04.10' })
    .getByRole('link', { name: 'Отчёт' });
  await expect(reportLink).toBeVisible();
  await reportLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Сводный отчёт' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const success = page.getByRole('region', { name: 'Успешно обработано' });
  const average = page.getByRole('region', { name: 'Средняя оценка' });
  expect((await success.boundingBox())!.y).toBeGreaterThan((await average.boundingBox())!.y);
  const table = page.getByRole('region', { name: 'Таблица звонков', exact: true });
  await table.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('heading', { name: 'Сводный отчёт' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.scratch/runtime/batch-report-mobile.png' });
});
