import { expect, test } from '@playwright/test';

test('заказчик входит в демо и видит батчи своей организации без промежуточных оценок', async ({
  page,
  baseURL,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL + '/')) {
      externalRequests.push(request.url());
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();

  await expect(page.getByRole('heading', { name: 'Батчи звонков' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('Контакт-центр');
  await expect(page.getByRole('navigation', { name: 'Основное меню' })).toContainText('Батчи');
  const processing = page.getByRole('row').filter({ hasText: 'Батч 06.10' });
  await expect(processing).toContainText('Обрабатывается');
  await expect(processing).toContainText('Ещё не опубликован');
  await expect(page.getByRole('row').filter({ hasText: 'Батч 04.10' })).toContainText('9,65 из 11');
  await expect(page.getByRole('button', { name: 'Поставить в очередь' })).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  await page.screenshot({ path: '.scratch/runtime/desktop-batches.png', fullPage: true });
});

test('смена стрима показывает загрузку и только батчи выбранного стрима', async ({ page }) => {
  await page.goto('/demo/customer/batches');
  await expect(page.getByRole('row').filter({ hasText: 'Батч 06.10' })).toBeVisible();
  await page.getByLabel('Стрим', { exact: true }).selectOption('outgoing');
  await expect(page.getByRole('status')).toContainText('Загружаем батчи');
  await expect(page.getByRole('row').filter({ hasText: 'Исходящие 06.10' })).toContainText(
    'В очереди',
  );
  await expect(page.getByRole('row').filter({ hasText: 'Батч 06.10' })).toHaveCount(0);
});

test('новый стрим показывает пустое состояние, а завершённый без результатов — отсутствие данных', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches');
  await expect(page.getByRole('row').filter({ hasText: 'Батч 02.10' })).toContainText('Нет данных');
  await page.getByLabel('Стрим', { exact: true }).selectOption('new-project');
  await expect(page.getByRole('heading', { name: 'Пока нет батчей' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('команда выбирает организацию и не смешивает её батчи с предыдущей', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await expect(page.getByRole('heading', { name: 'Батчи заказчиков' })).toBeVisible();
  await page.getByLabel('Организация', { exact: true }).selectOption('support');
  await expect(page.getByRole('heading', { name: 'Батчи заказчиков' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Поддержка 06.10' })).toContainText(
    '10 из 11',
  );
  await expect(page.getByRole('row').filter({ hasText: 'Батч 06.10' })).toHaveCount(0);
  await expect(page.getByRole('navigation')).toContainText('Заказчики');
});

test('последний выбор стрима побеждает незавершённый предыдущий запрос', async ({ page }) => {
  await page.goto('/demo/customer/batches');
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByLabel('Стрим', { exact: true }).selectOption('outgoing');
  await page.getByLabel('Стрим', { exact: true }).selectOption('incoming');
  await expect(page.getByRole('row').filter({ hasText: 'Батч 06.10' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Исходящие 06.10' })).toHaveCount(0);
});

test('на узком экране можно войти с клавиатуры и читать таблицу без переполнения страницы', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Открыть демо заказчика' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Подключиться по ключу' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Открыть демо заказчика' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const viewportFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(viewportFits).toBe(true);
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.screenshot({ path: '.scratch/runtime/mobile-batches.png', fullPage: true });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Загрузить ZIP' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Стрим', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const tableRegion = page.getByRole('region', { name: 'Таблица батчей' });
  await expect(tableRegion).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => tableRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({ path: '.scratch/runtime/mobile-table-focus.png', fullPage: true });
});

test('ошибка чтения списка объясняется пользователю и исправляется повтором', async ({ page }) => {
  await page.goto('/demo/customer/batches');
  await expect(page.getByRole('row').filter({ hasText: 'Батч 06.10' })).toBeVisible();
  await page.getByText('Демо-сценарии', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку списка' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить батчи');
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Батч 06.10' })).toBeVisible();
});
