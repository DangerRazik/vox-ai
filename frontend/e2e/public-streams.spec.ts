import { expect, test } from '@playwright/test';

test('переход к содержимому с клавиатуры сохраняет выбранный стрим', async ({ page }) => {
  await page.goto('/demo/customer/streams?organization=contact-center&stream=outgoing');
  const outgoing = page.getByRole('article', { name: 'Исходящие обращения' });
  await expect(outgoing).toContainText('Выбран для батчей');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(outgoing).toContainText('Выбран для батчей');
  await page.getByRole('navigation').getByRole('link', { name: 'Батчи' }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('outgoing');
  await expect(page.getByRole('row').filter({ hasText: 'Исходящие 06.10' })).toBeVisible();
});

test('параметры URL не открывают стримы чужой организации или административные действия', async ({
  page,
}) => {
  await page.goto('/demo/customer/streams?organization=support&stream=support-incoming');
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByRole('banner')).toContainText('Контакт-центр');
  await expect(page.getByRole('main')).not.toContainText('Поддержка клиентов');
  await expect(page.getByRole('article', { name: 'Входящие обращения' })).toContainText(
    'Выбран для батчей',
  );
  await expect(
    page.getByRole('article', { name: 'Исходящие обращения' }).getByRole('definition').nth(2),
  ).toHaveText('Выключено');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: /Скачать|Создать|Удалить|Редактировать/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Создать|Удалить|Редактировать/ })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Батчи' }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('incoming');
  await expect(page.getByRole('row').filter({ hasText: 'Батч 06.10' })).toBeVisible();
});

test('на узком экране правила раскрываются и батчи открываются с клавиатуры', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/customer/streams');
  const incoming = page.getByRole('article', { name: 'Входящие обращения' });
  await expect(incoming).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(incoming.getByRole('link', { name: 'Открыть батчи' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(incoming.getByText('Критерии оценки · 11', { exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(incoming.getByRole('listitem').last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.screenshot({ path: '.scratch/runtime/mobile-streams.png', fullPage: true });
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('incoming');
});

test('пустой список объясняет отсутствие готовых стримов', async ({ page }) => {
  await page.goto('/demo/customer/streams');
  await expect(page.getByRole('article')).toHaveCount(3);
  await page.getByText('Демо-сценарии стримов', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать пустой список' }).click();
  await expect(page.getByRole('heading', { name: 'Пока нет готовых стримов' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('main')).toContainText('Обратитесь к команде Vox AI');
  await expect(page.getByRole('link', { name: 'Открыть батчи' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Обновить список' }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
});

test('ошибка чтения скрывает карточки и допускает повтор без потери выбранного стрима', async ({
  page,
}) => {
  await page.goto('/demo/customer/streams?stream=outgoing');
  await expect(page.getByRole('article', { name: 'Исходящие обращения' })).toContainText(
    'Выбран для батчей',
  );
  await page.getByText('Демо-сценарии стримов', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку чтения' }).click();
  await expect(page.getByRole('status')).toContainText('Загружаем стримы');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить стримы');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Исходящие обращения' })).toContainText(
    'Выбран для батчей',
  );
});

test('заказчик читает публичные правила и выбирает стрим для батчей', async ({ page }) => {
  await page.goto('/demo/customer/batches');
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByLabel('Стрим', { exact: true }).selectOption('outgoing');
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы' }).click();
  await expect(page.getByRole('heading', { name: 'Готовые стримы' })).toBeVisible();
  const incoming = page.getByRole('article', { name: 'Входящие обращения' });
  const outgoing = page.getByRole('article', { name: 'Исходящие обращения' });
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(outgoing.locator('app-technical-details code')).toHaveText('outgoing');
  await expect(outgoing).toContainText('Выбран для батчей');
  await expect(incoming.getByRole('definition').first()).toHaveText('Включено');
  await incoming.getByText('Критерии оценки · 11', { exact: true }).click();
  await expect(incoming.getByRole('listitem')).toHaveCount(11);
  await expect(incoming).toContainText('Активная позиция и демонстрация внимания');
  await expect(incoming).toContainText('Постановка/снятие удержания');
  await expect(incoming).toContainText('Критическое нарушение');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Стримы' })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Батчи' }),
  ).not.toHaveAttribute('aria-current');
  await expect(
    page.getByText(/Промпт|Скачать|Создать стрим|Редактировать|Удалить стрим/),
  ).toHaveCount(0);
  await page.screenshot({ path: '.scratch/runtime/desktop-streams.png', fullPage: true });
  await incoming.getByRole('link', { name: 'Открыть батчи' }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('incoming');
  await expect(page.getByRole('row').filter({ hasText: 'Батч 06.10' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы' }).click();
  await expect(incoming).toContainText('Выбран для батчей');
  await outgoing.getByRole('link', { name: 'Открыть батчи' }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('outgoing');
  await expect(page.getByRole('row').filter({ hasText: 'Исходящие 06.10' })).toBeVisible();
});
