import { expect, test } from '@playwright/test';

test('из отчёта батча открывается разбор с исходными оценками и транскрипцией', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches/batch-04/report');
  await page
    .getByRole('row')
    .filter({ hasText: 'call_001.mp3' })
    .getByRole('link', { name: 'call_001.mp3', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Разбор звонка' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('call_001.mp3');
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toContainText('9,5 из 11');
  await expect(page.getByRole('group', { name: /Прощание/ })).toContainText('0,5 из 1');
  await expect(page.getByRole('region', { name: 'Транскрипция' })).toContainText(
    '00:00–00:08 · Сотрудник',
  );
  await expect(page.getByRole('region', { name: 'Транскрипция' })).toContainText(
    '00:08–00:15 · Клиент',
  );
  await expect(page.getByRole('region', { name: 'Метрики' })).toContainText('120 слов/мин');
  await expect(page.getByRole('region', { name: 'Проверка по базе знаний' })).toContainText(
    'Порядок оформления обращения',
  );
  await expect(page.getByRole('region', { name: 'Рекомендации' })).toContainText(
    'Перед завершением разговора',
  );
  await expect(page.locator('audio')).toHaveCount(0);
  await page.screenshot({ path: '.scratch/runtime/call-report-desktop.png' });
});

test('отсутствующие дополнительные результаты не подменяются выдуманными данными', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches/batch-04/calls/batch-04-call-3');
  await expect(page.getByRole('region', { name: 'Метрики', exact: true })).toContainText(
    'Метрики отсутствуют',
  );
  await expect(
    page.getByRole('region', { name: 'Проверка по базе знаний', exact: true }),
  ).toContainText('Результат проверки отсутствует');
  await expect(page.getByRole('region', { name: 'Рекомендации', exact: true })).toContainText(
    'Рекомендации отсутствуют',
  );
  await expect(page.getByRole('main')).not.toContainText('Дата:');
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toContainText('10 из 11');
});

test('критическое нарушение остаётся видимым при выключенном обнулении', async ({ page }) => {
  await page.goto('/demo/team/batches/support-06/report');
  await expect(page.getByRole('region', { name: 'Критические нарушения' })).toContainText(
    '1 из 30',
  );
  await page
    .getByRole('row')
    .filter({ hasText: 'call_002.mp3' })
    .getByRole('link', { name: 'call_002.mp3', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Критическое нарушение', exact: true }),
  ).toContainText('Обнуление отключено');
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toContainText('10 из 11');
  await page.getByRole('group', { name: 'Темп разговора', exact: true }).locator('summary').click();
  await expect(page.getByRole('group', { name: 'Темп разговора', exact: true })).toContainText(
    'Анализ темпа отключён',
  );
  await expect(page.getByRole('region', { name: 'Метрики', exact: true })).not.toContainText(
    'слов/мин',
  );
});

test('обнулённый итог сохраняет исходные оценки, а пояснение раскрывается с клавиатуры', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches/batch-04/report');
  await page
    .getByRole('row')
    .filter({ hasText: 'call_002.mp3' })
    .getByRole('link', { name: 'call_002.mp3', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toContainText('0 из 11');
  await expect(
    page.getByRole('region', { name: 'Критическое нарушение', exact: true }),
  ).toContainText('Итог обнулён');
  await expect(page.getByRole('group', { name: 'Приветствие', exact: true })).toContainText(
    '1 из 1',
  );
  await expect(
    page.getByRole('group', { name: 'Критическое нарушение', exact: true }),
  ).toContainText('0 из 1');
  await expect(page.getByRole('main')).toContainText('Сотрудник: Не указан');
  await expect(page.getByRole('main')).not.toContainText('Дата:');
  const holding = page.getByRole('group', { name: 'Постановка/снятие удержания', exact: true });
  await holding.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(holding.getByText('Критерий неприменим', { exact: false })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(holding.getByText('Критерий неприменим', { exact: false })).not.toBeVisible();
});

test('ошибочная запись открывает причину без выдуманных оценок и транскрипции', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches/batch-04/report');
  await page
    .getByRole('row')
    .filter({ hasText: 'call_081.mp3' })
    .getByRole('link', { name: 'call_081.mp3', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Ошибка обработки записи' })).toContainText(
    'Не удалось распознать речь',
  );
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Приветствие', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Транскрипция', exact: true })).toHaveCount(0);
});

test('повтор после сетевой ошибки сохраняет организацию и возврат к батчу', async ({ page }) => {
  await page.goto('/demo/team/batches/support-06/calls/support-06-call-1');
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toBeVisible();
  await page.getByText('Демо-сценарии', { exact: true }).click();
  await page.getByRole('button', { name: 'Показать ошибку звонка' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить разбор');
  await expect(page.getByRole('banner')).toContainText('Сервис поддержки');
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toContainText('10 из 11');
  await page.getByRole('link', { name: 'К отчёту батча' }).click();
  await expect(page.getByRole('banner')).toContainText('Сервис поддержки');
  await expect(page.getByRole('region', { name: 'Успешно обработано' })).toContainText('30 из 30');
});

test('чужой, отсутствующий или непубликованный звонок недоступен по прямому адресу', async ({
  page,
}) => {
  for (const [batch, call] of [
    ['support-06', 'support-06-call-1'],
    ['batch-04', 'missing-call'],
    ['batch-04', 'batch-02-call-1'],
  ]) {
    await page.goto(`/demo/customer/batches/${batch}/calls/${call}`);
    await expect(page.getByRole('heading', { name: 'Звонок не найден' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText('Сервис поддержки');
  }
  await page.goto('/demo/customer/batches/batch-06/calls/batch-06-call-1');
  await expect(page.getByRole('heading', { name: 'Разбор ещё недоступен' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toHaveCount(0);
});

test('на узком экране длинная транскрипция идёт после оценок и не перекрывает следующие блоки', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/customer/batches/batch-04/calls/batch-04-call-3');
  await expect(page.getByRole('heading', { name: 'Разбор звонка' })).toBeVisible();
  const grades = page.getByRole('region', { name: 'Исходные оценки критериев' });
  const transcript = page.getByRole('region', { name: 'Транскрипция', exact: true });
  const metrics = page.getByRole('region', { name: 'Метрики', exact: true });
  const gradesBox = (await grades.boundingBox())!;
  const transcriptBox = (await transcript.boundingBox())!;
  const metricsBox = (await metrics.boundingBox())!;
  expect(transcriptBox.y).toBeGreaterThanOrEqual(gradesBox.y + gradesBox.height);
  expect(metricsBox.y).toBeGreaterThanOrEqual(transcriptBox.y + transcriptBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.scratch/runtime/call-report-mobile.png' });
  await transcript.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.scratch/runtime/call-transcript-mobile.png' });
});
