import { expect, test } from '@playwright/test';

test('чужие и незавершённые батчи исключаются, повторы ID и повторный выбор не дублируют колонки', async ({
  page,
}) => {
  await page.goto(
    '/demo/customer/comparison?organization=support&stream=incoming&batch=batch-04&batch=batch-04&batch=batch-06&batch=support-06&batch=outgoing-06&batch=missing',
  );
  await expect(page.getByRole('banner')).toContainText('Контакт-центр');
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await expect(page.getByRole('status')).toContainText('Некоторые батчи недоступны');
  await expect(page.getByRole('checkbox', { name: /Батч 06.10|Поддержка|Исходящие/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Сравнить выбранные батчи' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Батч 02.10/ }).check();
  await page.getByRole('checkbox', { name: /Батч 04.10/ }).uncheck();
  await page.getByRole('checkbox', { name: /Батч 04.10/ }).check();
  await page.getByRole('checkbox', { name: /Батч 04.10/ }).check();
  await page.getByRole('button', { name: 'Сравнить выбранные батчи' }).click();
  await expect(page.getByRole('table').getByRole('columnheader')).toHaveText([
    'Показатель',
    'Батч 02.10',
    'Батч 04.10',
  ]);
  await page.screenshot({ path: '.scratch/runtime/desktop-comparison.png', fullPage: true });
});

test('смена стрима отменяет сравнение и очищает выбор, стрим без завершённых батчей объясняется', async ({
  page,
}) => {
  await page.goto('/demo/customer/comparison?stream=incoming&batch=batch-01&batch=batch-04');
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Сравнить выбранные батчи' }).click();
  await page.getByLabel('Стрим', { exact: true }).selectOption('outgoing');
  await expect(
    page.getByRole('heading', { name: 'Недостаточно завершённых батчей' }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByLabel('Стрим', { exact: true }).selectOption('incoming');
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Сравнить выбранные батчи' })).toBeDisabled();
  await page.getByRole('navigation').getByRole('link', { name: 'Батчи' }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('incoming');
});

test('на узком экране батчи выбираются с клавиатуры, таблица прокручивается внутри страницы', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/customer/comparison');
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Стрим', { exact: true })).toBeFocused();
  for (const name of ['Батч 01.10', 'Батч 04.10', 'Батч 02.10']) {
    await page.keyboard.press('Tab');
    const checkbox = page.getByRole('checkbox', { name: new RegExp(name) });
    await expect(checkbox).toBeFocused();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await expect(checkbox.locator('..')).toContainText('Колонка');
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Сравнить выбранные батчи' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table')).toBeVisible();
  await page.keyboard.press('Tab');
  const region = page.getByRole('region', { name: 'Таблица сравнения' });
  await expect(region).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.scratch/runtime/mobile-comparison.png', fullPage: true });
});

test('отчёт открывает сравнение с выбранным батчем и текущим стримом', async ({ page }) => {
  await page.goto('/demo/customer/batches/batch-04/report');
  await expect(page.getByRole('heading', { name: 'Сводный отчёт' })).toBeVisible();
  await page.getByRole('link', { name: 'Сравнить с другими батчами' }).click();
  await expect(page.getByRole('checkbox', { name: /Батч 04.10/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('incoming');
  await expect(page.getByRole('button', { name: 'Сравнить выбранные батчи' })).toBeDisabled();
});

test('сбой чтения сохраняет выбор, скрывает прежнюю таблицу и допускает повтор', async ({
  page,
  baseURL,
}) => {
  const remote: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL + '/')) remote.push(request.url());
  });
  await page.goto('/demo/customer/comparison?stream=incoming&batch=batch-01&batch=batch-04');
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Сравнить выбранные батчи' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByText('Демо-сценарии', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку сравнения' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить сравнение');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Повторить сравнение' }).click();
  await expect(page.getByRole('table').getByRole('columnheader')).toHaveText([
    'Показатель',
    'Батч 01.10',
    'Батч 04.10',
  ]);
  expect(remote).toEqual([]);
});

test('три завершённых батча сравниваются в порядке выбора с данными сводных отчётов', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches');
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Сравнение' }).click();
  await expect(page.getByRole('heading', { name: 'Сравнение батчей' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.getByRole('checkbox', { name: /Батч 01.10/ }).check();
  await page.getByRole('checkbox', { name: /Батч 04.10/ }).check();
  await page.getByRole('checkbox', { name: /Батч 02.10/ }).check();
  await page.getByRole('button', { name: 'Сравнить выбранные батчи' }).click();
  const table = page.getByRole('table', { name: 'Показатели выбранных батчей' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Показатель',
    'Батч 01.10',
    'Батч 04.10',
    'Батч 02.10',
  ]);
  await expect(
    table.getByRole('row').filter({ hasText: 'Средняя оценка, из 11' }).getByRole('cell'),
  ).toHaveText(['11', '9,65', 'Нет данных']);
  await expect(
    table.getByRole('row').filter({ hasText: 'Принято записей' }).getByRole('cell'),
  ).toHaveText(['2', '90', '12']);
  await expect(
    table.getByRole('row').filter({ hasText: 'Успешно обработано' }).getByRole('cell'),
  ).toHaveText(['2', '80', '0']);
  await expect(
    table.getByRole('row').filter({ hasText: 'Ошибки загрузки' }).getByRole('cell'),
  ).toHaveText(['0', '10', '3']);
  await expect(
    table.getByRole('row').filter({ hasText: 'Ошибки обработки' }).getByRole('cell'),
  ).toHaveText(['0', '10', '12']);
  await expect(
    table
      .getByRole('row')
      .filter({ hasText: 'Критические нарушения, из успешных звонков' })
      .getByRole('cell'),
  ).toHaveText(['0 из 2', '2 из 80', 'Нет данных']);
  await expect(
    table.getByRole('row').filter({ hasText: '5.2 · Критическое нарушение' }).getByRole('cell'),
  ).toHaveText(['1', '0,98', 'Нет данных']);
  await expect(table.getByRole('row')).toHaveCount(19);
  await table.getByRole('link', { name: 'Батч 01.10' }).click();
  await expect(page.getByRole('region', { name: 'Средняя оценка' })).toContainText('11 из 11');
  await expect(page.getByRole('region', { name: 'Успешно обработано' })).toContainText('2 из 2');
});
