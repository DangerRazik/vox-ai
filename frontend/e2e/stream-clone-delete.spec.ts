import { expect, test } from '@playwright/test';

test('создание на основе переносит настройки, требует реальные файлы и сохраняет прежнюю историю', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await page
    .getByRole('article')
    .filter({ hasText: 'Входящие обращения' })
    .getByRole('link', { name: 'Просмотреть стрим' })
    .click();
  await page.getByRole('link', { name: 'Создать на основе стрима' }).click();
  await expect(page.getByLabel('Название стрима', { exact: true })).toHaveValue(
    'Входящие обращения',
  );
  await expect(page.getByLabel('Промпт Whisper', { exact: true })).toHaveValue(
    'Демонстрационный промпт: распознай разговор с временными границами реплик.',
  );
  await expect(page.getByLabel('Обнулять итог при критическом нарушении')).toBeChecked();
  await expect(page.getByText('Выберите файлы заново', { exact: false })).toBeVisible();
  await page.screenshot({ path: '.scratch/runtime/stream-clone-desktop.png', fullPage: true });
  await page
    .getByLabel('Название стрима', { exact: true })
    .fill('Новые правила на основе входящих');
  await page.getByLabel('Промпт Whisper', { exact: true }).fill('Новая терминология для звонков');
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(
    page.getByText('Приложите непустой файл базы знаний.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Приложите непустой словарь нежелательных выражений/)).toBeVisible();
  await page.getByLabel('База знаний', { exact: true }).setInputFiles({
    name: 'new-kb.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Новые правила'),
  });
  await page.getByLabel('Словарь нежелательных выражений', { exact: true }).setInputFiles({
    name: 'new-unwanted.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('нежелательное'),
  });
  await page.getByLabel('Словарь корректировки текста', { exact: true }).setInputFiles({
    name: 'new-corrections.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('ошибка=правильно'),
  });
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toContainText(
    'Новая терминология для звонков',
  );
  const cloneId = /\/streams\/([^?]+)/.exec(page.url())![1];
  expect(cloneId).not.toBe('incoming');
  await page.getByRole('link', { name: 'К списку стримов' }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await page
    .getByRole('article')
    .filter({ hasText: 'Входящие обращения' })
    .getByRole('link', { name: 'Просмотреть стрим' })
    .click();
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toContainText(
    'Демонстрационный промпт: распознай разговор с временными границами реплик.',
  );
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).not.toContainText(
    'Новая терминология для звонков',
  );
  await page.getByRole('link', { name: 'Открыть батчи', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: 'Батч 04.10' })
    .getByRole('link', { name: /^Отчёт/ })
    .click();
  await expect(page.getByRole('region', { name: 'Средняя оценка', exact: true })).toContainText(
    '9,65',
  );
  await page.getByRole('link', { name: 'call_001.mp3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор звонка' })).toBeVisible();
  await expect(page.getByText('Добрый день!', { exact: false })).toBeVisible();
});

test('подтверждение удаления называет стрим и последствия, ждёт решения; отмена сохраняет снимок', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Входящие обращения' })).toBeVisible();
  await page.getByLabel('Организация', { exact: true }).selectOption('support');
  await page
    .getByRole('article')
    .filter({ hasText: 'Поддержка клиентов' })
    .getByRole('link', { name: 'Просмотреть стрим' })
    .click();
  const opener = page.getByRole('button', { name: 'Удалить стрим', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Удаление стрима' });
  await expect(dialog).toContainText('Поддержка клиентов');
  await expect(dialog).toContainText('батчи, транскрипции и вся история результатов');
  await page.screenshot({ path: '.scratch/runtime/stream-delete-desktop.png' });
  const cancel = dialog.getByRole('button', { name: 'Отмена', exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByRole('region', { name: 'Снимок стрима' })).toContainText(
    'support-incoming',
  );
  await opener.click();
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('link', { name: 'Открыть батчи', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Поддержка 06.10' })).toHaveCount(1);
});

test('удаление убирает снимок, батчи и отчёты только выбранного стрима', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByLabel('Организация', { exact: true }).selectOption('support');
  await page.getByRole('link', { name: /^Отчёт/ }).click();
  await expect(page.getByRole('heading', { name: 'Сводный отчёт' })).toBeVisible();
  await page.getByRole('link', { name: 'call_001.mp3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор звонка' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByLabel('Организация', { exact: true })).toHaveValue('support');
  await page.getByRole('link', { name: 'Просмотреть стрим' }).click();
  await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить стрим и историю' }).click();
  await expect(page.getByRole('heading', { name: 'Стрим удалён', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'К списку стримов', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Пока нет стримов' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Стрим не найден', exact: true })).toBeVisible();
  await page.goBack(); // Список стримов до удаления: данные перечитываются.
  await expect(page.getByRole('heading', { name: 'Пока нет стримов' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Звонок не найден' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Транскрипция', exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Отчёт не найден' })).toBeVisible();
  await page.goBack();
  await page.getByLabel('Организация', { exact: true }).selectOption('support');
  await expect(page.getByRole('heading', { name: 'Пока нет батчей' })).toBeVisible();
  await page.getByLabel('Организация', { exact: true }).selectOption('contact-center');
  await page
    .getByRole('row')
    .filter({ hasText: 'Батч 04.10' })
    .getByRole('link', { name: /^Отчёт/ })
    .click();
  await expect(page.getByRole('region', { name: 'Средняя оценка', exact: true })).toContainText(
    '9,65',
  );
});

for (const name of ['Входящие обращения', 'Исходящие обращения']) {
  test(`активная работа запрещает удаление: ${name}`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Открыть демо команды' }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
    await page
      .getByRole('article')
      .filter({ hasText: name })
      .getByRole('link', { name: 'Просмотреть стрим' })
      .click();
    await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Удалить стрим и историю' }).click();
    await expect(dialog.getByRole('alert')).toContainText('активный импорт или обработка');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Снимок стрима' })).toContainText(name);
    await page.getByRole('link', { name: 'Открыть батчи', exact: true }).click();
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: name === 'Входящие обращения' ? 'Батч 06.10' : 'Исходящие 04.10' }),
    ).toHaveCount(1);
  });
}

test('ошибка удаления сохраняет подтверждение и историю, повтор выполняется только по действию пользователя', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Входящие обращения' })).toBeVisible();
  await page.getByLabel('Организация', { exact: true }).selectOption('support');
  await page
    .getByRole('article')
    .filter({ hasText: 'Поддержка клиентов' })
    .getByRole('link', { name: 'Просмотреть стрим' })
    .click();
  await page.getByText('Демо-сценарии административных стримов', { exact: true }).click();
  await page.getByRole('button', { name: 'Сбой следующего удаления' }).click();
  await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Удалить стрим и историю' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Не удалось удалить стрим');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('link', { name: 'Открыть батчи', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Поддержка 06.10' })).toHaveCount(1);
  await page.goBack();
  await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить стрим и историю' }).click();
  await expect(page.getByRole('heading', { name: 'Стрим удалён', exact: true })).toBeVisible();
});

test('удаление убирает новый загруженный батч из административного и клиентского разделов', async ({
  page,
}) => {
  await page.goto('/demo/customer/upload?stream=new-project');
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'delete-me.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('demo'),
  });
  await page.getByRole('button', { name: 'Имитировать приём', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма' })).toBeVisible();
  await page.getByRole('link', { name: 'К списку батчей', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'delete-me.zip' })).toHaveCount(1);
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
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
  await expect(
    page.getByLabel('Стрим', { exact: true }).getByRole('option', { name: 'Новый проект' }),
  ).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'delete-me.zip' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Батч 04.10' })).toHaveCount(1);
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Новый проект' })).toHaveCount(0);
  await expect(page.getByRole('article').filter({ hasText: 'Входящие обращения' })).toHaveCount(1);
});

test('узкий экран: подтверждение помещается и ждёт решения, клон сохраняет выключенные опции', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Стримы', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Входящие обращения' })).toBeVisible();
  await page.getByLabel('Организация', { exact: true }).selectOption('support');
  await page
    .getByRole('article')
    .filter({ hasText: 'Поддержка клиентов' })
    .getByRole('link', { name: 'Просмотреть стрим' })
    .click();
  await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: '.scratch/runtime/stream-delete-mobile.png' });
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Удалить стрим и историю' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Создать на основе стрима' }).click();
  await expect(page.getByLabel('Анализ темпа речи', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Обнулять итог при критическом нарушении')).not.toBeChecked();
  await expect(
    page.getByLabel('Корректировка текста транскрипции', { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel('Словарь корректировки текста', { exact: true })).toBeDisabled();
  await page.screenshot({ path: '.scratch/runtime/stream-clone-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('чужой исходный стрим не подставляется, а заказчик не получает административные действия', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть демо команды' }).click();
  await page.goto('/demo/team/streams/new?organization=support&basedOn=incoming');
  await expect(page.getByRole('heading', { name: 'Исходный стрим не найден' })).toBeVisible();
  await expect(page.getByLabel('Промпт LLM', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'К списку стримов', exact: true }).click();
  await expect(page.getByLabel('Организация', { exact: true })).toHaveValue('support');
  await page.getByRole('link', { name: 'Выйти из демо' }).click();
  await page.getByRole('button', { name: 'Открыть демо заказчика' }).click();
  await page.goto('/demo/team/streams/new?organization=contact-center&basedOn=incoming');
  await expect(
    page.getByRole('heading', { name: 'Доступ только для команды Vox AI' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Создать стрим|Удалить стрим/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
