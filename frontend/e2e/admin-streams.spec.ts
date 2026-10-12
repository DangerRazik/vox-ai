import { expect, test } from '@playwright/test';

test('новый заказчик получает собственный стрим; смена организации не смешивает каталоги', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Заказчики', exact: true }).click();
  await page.getByLabel('Название заказчика', { exact: true }).fill('Новая организация со стримом');
  await page.getByRole('button', { name: 'Создать заказчика', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Заказчик создан' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await page
    .getByLabel('Организация', { exact: true })
    .selectOption({ label: 'Новая организация со стримом' });
  await expect(page.getByRole('heading', { name: 'Пока нет стримов' })).toBeVisible();
  await page.getByRole('link', { name: 'Создать стрим', exact: true }).click();
  await page.getByLabel('Название стрима', { exact: true }).fill('Первый стрим новой организации');
  await page.getByLabel('Промпт Whisper', { exact: true }).fill('Распознай разговор');
  await page.getByLabel('Поиск нежелательных выражений', { exact: true }).uncheck();
  await page.getByLabel('Корректировка текста транскрипции', { exact: true }).uncheck();
  await page.getByLabel('База знаний', { exact: true }).setInputFiles({
    name: 'new-org.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Новые правила'),
  });
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toContainText(
    'Первый стрим новой организации',
  );
  await page.getByRole('link', { name: 'К списку стримов' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByLabel('Организация', { exact: true }).selectOption('contact-center');
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(
    page.getByRole('article').filter({ hasText: 'Первый стрим новой организации' }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(
    page.getByRole('article').filter({ hasText: 'Первый стрим новой организации' }),
  ).toHaveCount(0);
});

test('на узком экране форму можно заполнить с клавиатуры, после создания фокус переходит к просмотру', async ({
  page,
  baseURL,
}) => {
  const remote: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL + '/')) remote.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await page.getByRole('link', { name: 'Создать стрим', exact: true }).click();
  await expect(page.getByLabel('Название стрима', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Перейти к содержимому' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'К списку стримов' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Название стрима', { exact: true })).toBeFocused();
  await page.keyboard.type('Мобильные правила');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Промпт Whisper', { exact: true })).toBeFocused();
  await page.keyboard.type('Распознай речь');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space'); // Отключаем темп.
  await expect(page.getByLabel('Анализ темпа речи', { exact: true })).not.toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space'); // Отключаем поиск, поле словаря пропускается.
  await expect(page.getByLabel('Словарь нежелательных выражений', { exact: true })).toBeDisabled();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space'); // Отключаем корректировку.
  await expect(page.getByLabel('Словарь корректировки текста', { exact: true })).toBeDisabled();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('База знаний', { exact: true })).toBeFocused();
  await page.getByLabel('База знаний', { exact: true }).setInputFiles({
    name: 'mobile.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Порядок обслуживания'),
  });
  const criteria = page.getByText('11 фиксированных критериев оценки', { exact: true });
  await criteria.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.stream-criteria input')).toHaveCount(0);
  await expect(page.getByRole('listitem')).toHaveCount(11);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.scratch/runtime/mobile-stream-form.png', fullPage: true });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Создать стрим', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toContainText(
    'Мобильные правила',
  );
  await expect(page.getByRole('heading', { name: 'Просмотр стрима', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.scratch/runtime/mobile-stream-snapshot.png', fullPage: true });
  expect(remote).toEqual([]);
});

test('заказчик не открывает административный список, форму и снимок по прямому URL', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  for (const path of [
    '/demo/team/streams?organization=contact-center',
    '/demo/team/streams/new?organization=contact-center',
    '/demo/team/streams/incoming?organization=contact-center',
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'Доступ только для команды Vox AI' }),
    ).toBeVisible();
    await expect(page.getByLabel('Промпт Whisper', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Снимок стрима' })).toHaveCount(0);
  }
});

test('неполные материалы не создают стрим; исправление не стирает промпты', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await page.getByRole('link', { name: 'Создать стрим', exact: true }).click();
  await page.getByLabel('Название стрима', { exact: true }).fill('Проверка материалов');
  await page.getByLabel('Промпт Whisper', { exact: true }).fill('Сохранённый Whisper');
  await page
    .getByLabel('База знаний', { exact: true })
    .setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(
    page.getByText('Приложите непустой файл базы знаний.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Название стрима', { exact: true })).toHaveValue(
    'Проверка материалов',
  );
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toHaveCount(0);
  await page.getByRole('link', { name: 'К списку стримов' }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Проверка материалов' })).toHaveCount(0);
});

test('ошибки списка и снимка скрывают прежние данные, повтор возвращает тот же снимок', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
  await page.getByText('Демо-сценарии административных стримов', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку чтения' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить стримы');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
  await page
    .getByRole('article')
    .filter({ hasText: 'Входящие обращения' })
    .getByRole('link', { name: 'Просмотреть стрим' })
    .click();
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toContainText('ID: incoming');
  await page.getByText('Демо-сценарии административных стримов', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку чтения' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить снимок стрима');
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toContainText('ID: incoming');
  await page.goto('/demo/team/streams/incoming?organization=support');
  await expect(page.getByRole('heading', { name: 'Стрим не найден' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toHaveCount(0);
  await page.getByRole('link', { name: 'К списку стримов', exact: true }).click();
  await expect(page.getByLabel('Организация', { exact: true })).toHaveValue('support');
});

test('ошибка создания сохраняет настройки и файлы; повтор создаёт один стрим', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await page.getByRole('link', { name: 'Создать стрим', exact: true }).click();
  await page.getByLabel('Название стрима', { exact: true }).fill('Повтор без потери материалов');
  await page.getByLabel('Промпт Whisper', { exact: true }).fill('Распознай речь');
  await page.getByLabel('Поиск нежелательных выражений', { exact: true }).uncheck();
  await page.getByLabel('Корректировка текста транскрипции', { exact: true }).uncheck();
  await page.getByLabel('Анализ темпа речи', { exact: true }).uncheck();
  await page.getByLabel('Обнулять итог при критическом нарушении').uncheck();
  const knowledge = page.getByLabel('База знаний', { exact: true });
  await knowledge.setInputFiles({
    name: 'retained.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Правила'),
  });
  await page.getByText('Демо-сценарии административных стримов', { exact: true }).click();
  await page.getByRole('button', { name: 'Сбой следующего создания' }).click();
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось создать стрим');
  await expect(page.getByLabel('Название стрима', { exact: true })).toHaveValue(
    'Повтор без потери материалов',
  );
  await expect(page.getByLabel('Промпт Whisper', { exact: true })).toHaveValue('Распознай речь');
  expect(
    await knowledge.evaluate((element: HTMLInputElement) => element.files?.item(0)?.name),
  ).toBe('retained.txt');
  await page.getByRole('button', { name: 'Повторить создание' }).click();
  const snapshot = page.getByRole('region', { name: 'Снимок стрима' });
  await expect(snapshot).toContainText('retained.txt');
  await expect(
    snapshot
      .locator('div')
      .filter({ has: page.locator('dt', { hasText: 'Анализ темпа речи' }) })
      .last(),
  ).toContainText('Выключено');
  await expect(snapshot).toContainText('Не используется: опция выключена');
  await page.getByRole('link', { name: 'К списку стримов', exact: true }).click();
  await expect(
    page.getByRole('article').filter({ hasText: 'Повтор без потери материалов' }),
  ).toHaveCount(1);
});

test('команда создаёт стрим, просматривает снимок и открывает его в батчах и публичном каталоге', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Стримы заказчика' })).toBeVisible();
  await page.getByRole('link', { name: 'Создать стрим', exact: true }).click();
  await expect(page.getByLabel('Обнулять итог при критическом нарушении')).toBeChecked();
  await page.getByLabel('Название стрима', { exact: true }).fill('Новые правила входящих');
  await page
    .getByLabel('Промпт Whisper', { exact: true })
    .fill('Точно распознавай названия услуг.');
  await page.getByLabel('Словарь нежелательных выражений', { exact: true }).setInputFiles({
    name: 'unwanted.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('грубость'),
  });
  await page.getByLabel('Словарь корректировки текста', { exact: true }).setInputFiles({
    name: 'corrections.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"вокс":"Vox"}'),
  });
  await page.getByLabel('База знаний', { exact: true }).setInputFiles({
    name: 'knowledge.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<p>Правила обслуживания</p>'),
  });
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  const snapshot = page.getByRole('region', { name: 'Снимок стрима' });
  await expect(snapshot).toContainText('Новые правила входящих');
  await expect(snapshot).toContainText('Точно распознавай названия услуг.');
  await expect(snapshot).not.toContainText('Промпт LLM');
  await expect(snapshot).toContainText('knowledge.html');
  await expect(snapshot).toContainText('unwanted.txt');
  await expect(snapshot).toContainText('corrections.json');
  await expect(snapshot.getByRole('listitem')).toHaveCount(11);
  const streamId = /\/streams\/([^?]+)/.exec(page.url())![1];
  expect(streamId).not.toBe('incoming');
  await expect(page.getByRole('button', { name: /Сохранить|Редактировать/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Открыть батчи', exact: true }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue(streamId);
  await expect(page.getByRole('heading', { name: 'Пока нет батчей' })).toBeVisible();
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  const card = page.getByRole('article').filter({ hasText: 'Новые правила входящих' });
  await expect(card).toBeVisible();
  await expect(card).not.toContainText('Точно распознавай названия услуг.');
  await expect(card).not.toContainText('knowledge.html');
  await card.getByRole('link', { name: 'Открыть батчи' }).click();
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue(streamId);
});
