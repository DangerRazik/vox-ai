import { expect, test } from '@playwright/test';

test('отказ буфера обмена сохраняет ключ для ручного копирования', async ({ page }) => {
  // Буфер обмена — внешняя браузерная граница; моделируем отказ разрешения.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new DOMException('Denied', 'NotAllowedError');
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Заказчики' }).click();
  await page.getByLabel('Название заказчика', { exact: true }).fill('Копирование вручную');
  await page.getByRole('button', { name: 'Создать заказчика', exact: true }).click();
  const key = page.getByLabel('Демонстрационный ключ');
  await expect(key).toBeVisible();
  const issued = await key.inputValue();
  await page.getByRole('button', { name: 'Скопировать ключ' }).click();
  await expect(page.getByRole('alert')).toContainText('скопируйте вручную');
  await expect(key).toHaveValue(issued);
  await expect(key).toHaveAttribute('readonly', '');
});

test('выход из демо команды прекращает доступ к административному экрану', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Заказчики' }).click();
  await expect(page.getByLabel('Название заказчика', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.goto('/demo/team/customers');
  await expect(
    page.getByRole('heading', { name: 'Доступ только для команды Vox AI' }),
  ).toBeVisible();
  await expect(page.getByLabel('Название заказчика', { exact: true })).toHaveCount(0);
});

test('на узком экране заказчик создаётся с клавиатуры, результат остаётся до явного закрытия', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const remote: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL + '/')) remote.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Заказчики' }).click();
  const name = page.getByLabel('Название заказчика', { exact: true });
  await expect(name).toBeVisible();
  await page.getByRole('link', { name: 'Перейти к содержимому' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(name).toBeFocused();
  await page.keyboard.type('   ');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Укажите название заказчика');
  await expect(name).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Мобильный заказчик');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const key = page.getByLabel('Демонстрационный ключ');
  await expect(key).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Скопировать ключ' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Заказчик создан' }).getByRole('status'),
  ).toContainText('Ключ скопирован');
  await expect(key).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.scratch/runtime/mobile-customers-key.png', fullPage: true });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Закрыть результат' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(key).toHaveCount(0);
  await expect(name).toBeFocused();
  expect(remote).toEqual([]);
});

test('ошибка списка не стирает форму и исправляется повтором', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Заказчики' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByLabel('Название заказчика', { exact: true }).fill('Черновик организации');
  await page.getByText('Демо-сценарии заказчиков', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку списка' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить заказчиков');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByLabel('Название заказчика', { exact: true })).toHaveValue(
    'Черновик организации',
  );
  await page.getByRole('button', { name: 'Повторить список' }).click();
  await expect(page.getByRole('row')).toHaveCount(3);
  await expect(page.getByLabel('Название заказчика', { exact: true })).toHaveValue(
    'Черновик организации',
  );
});

test('ошибка создания сохраняет имя, исправление и повтор создают только одну организацию', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Заказчики' }).click();
  await page.getByLabel('Название заказчика', { exact: true }).fill('Первое название');
  await page.getByText('Демо-сценарии заказчиков', { exact: true }).click();
  await page.getByRole('button', { name: 'Сбой следующего создания' }).click();
  await page.getByRole('button', { name: 'Создать заказчика', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось создать заказчика');
  await expect(page.getByLabel('Название заказчика', { exact: true })).toHaveValue(
    'Первое название',
  );
  await expect(page.getByRole('row').filter({ hasText: 'Первое название' })).toHaveCount(0);
  await expect(page.getByLabel('Демонстрационный ключ')).toHaveCount(0);
  await page.getByLabel('Название заказчика', { exact: true }).fill('Исправленное название');
  await page.getByRole('button', { name: 'Повторить создание' }).click();
  await expect(page.getByRole('region', { name: 'Заказчик создан' })).toContainText(
    'Исправленное название',
  );
  await expect(page.getByRole('row').filter({ hasText: 'Исправленное название' })).toHaveCount(1);
  await expect(page.getByRole('table')).not.toContainText('Первое название');
});

test('режим заказчика и подмена URL не открывают административное создание', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Заказчики' })).toHaveCount(
    0,
  );
  await page.goto('/demo/team/customers?role=team');
  await expect(
    page.getByRole('heading', { name: 'Доступ только для команды Vox AI' }),
  ).toBeVisible();
  await expect(page.getByLabel('Название заказчика', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Создать заказчика', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Демонстрационный ключ')).toHaveCount(0);
});

test('команда создаёт заказчика, копирует условный ключ и видит организацию в батчах', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Заказчики' }).click();
  await expect(page.getByRole('heading', { name: 'Заказчики' })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(3);
  await page.getByLabel('Название заказчика', { exact: true }).fill('Новый контакт-центр');
  await page.getByRole('button', { name: 'Создать заказчика', exact: true }).click();
  const result = page.getByRole('region', { name: 'Заказчик создан' });
  await expect(result).toContainText('Новый контакт-центр');
  const key = await result.getByLabel('Демонстрационный ключ').inputValue();
  expect(key).toMatch(/^demo-only-/);
  await expect(result).toContainText('Не подходит для подключения к backend');
  await result.getByRole('button', { name: 'Скопировать ключ' }).click();
  await expect(result.getByRole('status')).toContainText('Ключ скопирован');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
  await expect(page.getByRole('table')).not.toContainText(key);
  await expect(page.getByRole('row').filter({ hasText: 'Новый контакт-центр' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть результат' }).click();
  await expect(page.getByLabel('Демонстрационный ключ')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Выдать|Заменить|Отозвать|Удалить/ })).toHaveCount(0);
  await page
    .getByRole('row')
    .filter({ hasText: 'Новый контакт-центр' })
    .getByRole('link', { name: 'Батчи заказчика' })
    .click();
  await expect(page.getByLabel('Организация', { exact: true })).toHaveValue(/.+/);
  await expect(
    page.getByLabel('Организация', { exact: true }).locator('option:checked'),
  ).toHaveText('Новый контакт-центр');
  await expect(page.getByRole('heading', { name: 'Пока нет батчей' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Заказчики' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Новый контакт-центр' })).toHaveCount(1);
  await expect(page.getByLabel('Демонстрационный ключ')).toHaveCount(0);
});
