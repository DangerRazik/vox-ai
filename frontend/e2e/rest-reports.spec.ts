import { expect, test, Page } from '@playwright/test';

const ids = ['1.1', '1.2', '2.1', '2.2', '2.3', '2.4', '3.1', '3.2', '4.1', '5.1', '5.2'];
const stream = {
  stream_id: 's1',
  customer_id: 'o1',
  name: 'Поддержка',
  created_at: '2026-10-01T00:00:00Z',
  options: {
    speech_rate_enabled: false,
    zero_total_on_critical: true,
    text_correction_enabled: false,
    unwanted_expressions_enabled: true,
  },
  criteria: ids.map((id) => ({ id, title: id })),
};
const batch = {
  batch_id: 'b1',
  customer_id: 'o1',
  stream_id: 's1',
  upload_id: 'u1',
  created_at: '2026-10-01T00:00:00Z',
  status: 'completed',
  total_calls: 2,
};
const summary = {
  batch_id: 'b1',
  stream_id: 's1',
  total_calls: 2,
  successful_calls: 1,
  processing_errors: 1,
  upload_errors: 3,
  average_total: 0,
  max_total: 11,
  critical_violation_count: 1,
  critical_violation_rate: 1,
  criterion_averages: Object.fromEntries(ids.map((id) => [id, id === '5.2' ? 0 : 1])),
};
const calls = ['c1', 'c2'].map((call_id) => ({
  call_id,
  batch_id: 'b1',
  stream_id: 's1',
  original_name: `${call_id}.mp3`,
  external_employee_id: null,
  called_at: null,
  duration_seconds: 30,
}));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/streams?*', (r) => r.fulfill({ json: { items: [stream] } }));
  await page.route('**/api/v1/batches?*', (r) => r.fulfill({ json: { items: [batch] } }));
  await page.route('**/api/v1/streams/s1/dashboard', (r) =>
    r.fulfill({ json: { items: [summary] } }),
  );
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({ json: { role: 'customer', customer: { customer_id: 'o1', name: 'Заказчик' } } }),
  );
  await page.route('**/api/v1/batches/b1', (r) => r.fulfill({ json: batch }));
  await page.route('**/api/v1/streams/s1', (r) => r.fulfill({ json: stream }));
  await page.route('**/api/v1/batches/b1/report', (r) => r.fulfill({ json: summary }));
  await page.route('**/api/v1/batches/b1/calls', (r) => r.fulfill({ json: { items: calls } }));
  await page.route('**/api/v1/calls/c1/report', (r) =>
    r.fulfill({
      json: {
        ...calls[0],
        status: 'successful',
        error: null,
        result: {
          scores: Object.fromEntries(
            ids.map((id) => [
              id,
              {
                score: id === '5.2' ? 0 : 1,
                max: 1,
                reason: id === '3.2' ? 'не применимо, зачтено по умолчанию' : 'Пояснение сервера',
              },
            ]),
          ),
          total: 0,
          original_total: 10,
          max_total: 11,
          critical_violation: true,
          critical_violation_details: 'Грубое обращение',
          _segments: [
            { role: 'OPERATOR', start: 0, end: 3, text: 'Здравствуйте!' },
            { role: 'CLIENT', start: 4, end: 8, text: 'Нужна помощь' },
          ],
          _metrics: {
            long_pauses_count: 1,
            total_duration_sec: 8,
            long_pauses: [{ at: 3.125, sec: 1.25, after: 'Здравствуйте!', before: 'Нужна помощь' }],
            interruptions: [{ at: 4.19, by: 'CLIENT', phrase: 'Уточню' }],
            unwanted_expressions: [{ expression: 'грубость', count: 1 }],
          },
          kb_check: {
            questions_detected: ['О возврате'],
            operator_answers_correct: false,
            mismatches: [
              { question: 'Возврат', operator_said: 'Нельзя', kb_says: 'Можно по заявлению' },
            ],
          },
          recommendations: ['Пояснить порядок возврата'],
        },
      },
    }),
  );
  await page.route('**/api/v1/calls/c2/report', (r) =>
    r.fulfill({
      json: {
        ...calls[1],
        status: 'processing_error',
        result: null,
        error: 'call_processing_failed',
      },
    }),
  );
});
async function login(page: Page) {
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('report-test-key');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/batches$/);
}
test('REST отчёт сохраняет опубликованный ноль, исходные оценки и реальные блоки разбора', async ({
  page,
}) => {
  await login(page);
  await page.goto('/customer/batches/b1/report');
  await expect(page.getByRole('heading', { name: 'Сводный отчёт', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Критические нарушения', exact: true }),
  ).toContainText('1 из 1');
  await expect(
    page.getByRole('region', { name: 'Критические нарушения', exact: true }),
  ).not.toContainText('%');
  await expect(page.getByRole('region', { name: 'Средняя оценка', exact: true })).toContainText(
    '0 из 11',
  );
  await expect(page.getByRole('row', { name: /c2.mp3/ })).toContainText('Нет данных');
  await page.getByRole('link', { name: 'c1.mp3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор звонка', exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText('Грубое обращение');
  await expect(page.locator('body')).toContainText('Здравствуйте!');
  await expect(page.locator('body')).toContainText('00:00–00:03 · Сотрудник');
  await expect(page.locator('body')).toContainText('Можно по заявлению');
  await expect(page.locator('body')).toContainText('грубость');
  await expect(page.locator('body')).toContainText('На 3,13 с: пауза 1,25 с');
  await expect(page.locator('body')).toContainText('На 4,19 с: Клиент — «Уточню»');
  await page.getByLabel('Работа с конфликтом', { exact: true }).locator('summary').click();
  await expect(page.getByLabel('Работа с конфликтом', { exact: true })).toContainText(
    'Оценка 1 по умолчанию',
  );
  await expect(page.getByText('Демо · условные данные')).toHaveCount(0);
});

test('null и ошибки не становятся нулевой оценкой, разбор ошибки честно объясняет исход', async ({
  page,
}) => {
  await page.route('**/api/v1/batches/b1/report', (r) =>
    r.fulfill({
      json: {
        ...summary,
        successful_calls: 0,
        processing_errors: 2,
        average_total: null,
        critical_violation_count: 0,
        critical_violation_rate: null,
        criterion_averages: Object.fromEntries(ids.map((id) => [id, null])),
      },
    }),
  );
  await page.route('**/api/v1/calls/c1/report', (r) =>
    r.fulfill({
      json: {
        ...calls[0],
        status: 'processing_error',
        result: null,
        error: 'call_processing_failed',
      },
    }),
  );
  await login(page);
  await page.getByRole('link', { name: /Отчёт/ }).click();
  await expect(page.getByRole('region', { name: 'Средняя оценка', exact: true })).toContainText(
    'Нет данных',
  );
  await expect(
    page
      .getByRole('figure', { name: 'График оценок критериев', exact: true })
      .getByText('Нет данных'),
  ).toHaveCount(11);
  await expect(page.getByRole('row', { name: /c1.mp3/ })).toContainText('Ошибка обработки записи');
  await page.getByRole('link', { name: 'c1.mp3', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Запись не обработана', exact: true }),
  ).toBeVisible();
  await expect(page.locator('app-call-grades')).toHaveCount(0);
});

test('неопубликованный и недоступный отчёт не раскрывают оценки; временный сбой можно повторить', async ({
  page,
}) => {
  await page.route('**/api/v1/batches/b1', (r) =>
    r.fulfill({ json: { ...batch, status: 'processing' } }),
  );
  await login(page);
  await page.goto('/customer/batches/b1/report');
  await expect(
    page.getByRole('heading', { name: 'Отчёт ещё недоступен', exact: true }),
  ).toBeVisible();
  await expect(page.locator('app-report-summary')).toHaveCount(0);
  await page.goto('/customer/batches/b1/calls/c1');
  await expect(
    page.getByRole('heading', { name: 'Разбор ещё недоступен', exact: true }),
  ).toBeVisible();
  await page.route('**/api/v1/batches/b1', (r) =>
    r.fulfill({ status: 404, json: { error: { code: 'not_found' } } }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Звонок не найден', exact: true })).toBeVisible();
  await page.route('**/api/v1/batches/b1', (r) => r.fulfill({ json: batch }));
  let failed = true;
  await page.route('**/api/v1/calls/c1/report', (r) =>
    failed
      ? r.fulfill({ status: 503, json: {} })
      : r.fulfill({
          json: {
            ...calls[0],
            batch_id: 'another',
            status: 'processing_error',
            result: null,
            error: 'call_processing_failed',
          },
        }),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Не удалось загрузить разбор', exact: true }),
  ).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Звонок не найден', exact: true })).toBeVisible();
  await expect(page.getByText('c1.mp3', { exact: true })).toHaveCount(0);
});

test('обнуление отключено, неизвестная роль и отсутствующие блоки отображаются без выдуманных данных', async ({
  page,
}) => {
  await page.route('**/api/v1/streams/s1', (r) =>
    r.fulfill({
      json: { ...stream, options: { ...stream.options, zero_total_on_critical: false } },
    }),
  );
  await page.route('**/api/v1/calls/c1/report', (r) =>
    r.fulfill({
      json: {
        ...calls[0],
        status: 'successful',
        error: null,
        result: {
          total: 9.5,
          critical_violation: true,
          scores: Object.fromEntries(
            ids.map((id) => [
              id,
              { score: id === '5.2' ? 0 : id === '1.2' ? 0.5 : 1, reason: 'Пояснение сервера' },
            ]),
          ),
          _segments: [{ role: 'UNKNOWN', start: 1.234, end: 3.456, text: 'Уточните вопрос' }],
        },
      },
    }),
  );
  await login(page);
  await page.goto('/customer/batches/b1/calls/c1');
  await expect(page.getByRole('region', { name: 'Итоговая оценка', exact: true })).toContainText(
    '9,5 из 11',
  );
  await expect(
    page.getByRole('region', { name: 'Критическое нарушение', exact: true }),
  ).toContainText('Обнуление отключено');
  await expect(page.locator('body')).toContainText('00:01,234–00:03,456 · Участник не определён');
  await expect(page.locator('body')).toContainText('Метрики отсутствуют');
  await expect(page.locator('body')).toContainText('Результат проверки отсутствует');
  await expect(page.locator('body')).toContainText('Рекомендации отсутствуют');
  await expect(page.locator('audio')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Прощание', { exact: true }).locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Прощание', { exact: true })).toHaveAttribute('open', '');
});

async function comparisonCatalog(page: Page) {
  const second = { ...batch, batch_id: 'b2', upload_id: 'u2' };
  const secondSummary = {
    ...summary,
    batch_id: 'b2',
    average_total: null,
    successful_calls: 0,
    processing_errors: 2,
    critical_violation_count: 0,
    critical_violation_rate: null,
    criterion_averages: Object.fromEntries(ids.map((id) => [id, null])),
  };
  await page.route('**/api/v1/batches?*', (r) =>
    r.fulfill({
      json: { items: [batch, second, { ...batch, batch_id: 'pending', status: 'processing' }] },
    }),
  );
  await page.route('**/api/v1/streams/s1/dashboard', (r) =>
    r.fulfill({ json: { items: [summary, secondSummary] } }),
  );
  await page.route('**/api/v1/batches/b2', (r) => r.fulfill({ json: second }));
  return { secondSummary };
}
test('сравнение сохраняет порядок, исключает повторы и незавершённые батчи и ведёт к рабочему отчёту', async ({
  page,
}) => {
  const { secondSummary } = await comparisonCatalog(page);
  let selected: string[] = [];
  await page.route('**/api/v1/streams/s1/comparisons', (r) => {
    expect(r.request().method()).toBe('POST');
    expect(r.request().headers()['authorization']).toBe('Bearer report-test-key');
    selected = r.request().postDataJSON().batch_ids;
    return r.fulfill({ json: { stream_id: 's1', items: [secondSummary, summary] } });
  });
  await login(page);
  await page.goto('/customer/comparison?stream=s1&batch=b2&batch=b1&batch=b2&batch=pending');
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByRole('status')).toContainText('Некоторые батчи недоступны');
  await page.getByRole('button', { name: 'Сравнить выбранные батчи', exact: true }).click();
  const table = page.getByRole('region', { name: 'Таблица сравнения', exact: true });
  await expect(table).toBeVisible();
  expect(selected).toEqual(['b2', 'b1']);
  await expect(
    table.getByRole('row', { name: /Средняя оценка, из 11/ }).getByRole('cell'),
  ).toHaveText(['Нет данных', '0']);
  await expect(table.getByRole('row')).toHaveCount(19);
  await expect(table.getByRole('link').first()).toHaveAttribute(
    'href',
    '/customer/batches/b2/report',
  );
  await table.getByRole('link').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Сводный отчёт', exact: true })).toBeVisible();
});

for (const [status, code, message] of [
  [409, 'comparison_stream_mismatch', 'Выбранные батчи относятся к разным стримам.'],
  [409, 'report_not_available', 'Не все выбранные батчи имеют опубликованный отчёт.'],
  [403, 'forbidden', 'Один из выбранных батчей или стрим удалён либо недоступен.'],
] as const) {
  test(`сравнение объясняет ${code} и сохраняет выбор`, async ({ page }) => {
    await comparisonCatalog(page);
    await page.route('**/api/v1/streams/s1/comparisons', (r) =>
      r.fulfill({ status, json: { error: { code } } }),
    );
    await login(page);
    await page.goto('/customer/comparison?stream=s1&batch=b1&batch=b2');
    await page.getByRole('button', { name: 'Сравнить выбранные батчи', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
    await expect(page.locator('app-comparison-table')).toHaveCount(0);
  });
}

test('401 при чтении отчёта удаляет подключение и требует нового ключа', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/batches/b1/report', (r) =>
    r.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } }),
  );
  await page.goto('/customer/batches/b1/report');
  await expect(page).toHaveURL(/\/connect$/);
  await expect(page.locator('body')).toContainText('Ключ отклонён');
  expect(await page.evaluate(() => localStorage.getItem('vox-api-connection'))).toBeNull();
  await expect(page.locator('app-report-summary')).toHaveCount(0);
});

test('временный сбой сравнения допускает повтор; смена выбора отменяет поздний результат', async ({
  page,
}) => {
  const { secondSummary } = await comparisonCatalog(page);
  let attempt = 0;
  let release: (() => void) | undefined;
  await page.route('**/api/v1/streams/s1/comparisons', async (r) => {
    attempt++;
    if (attempt === 1) return r.fulfill({ status: 503, json: {} });
    if (attempt === 3)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await r.fulfill({ json: { stream_id: 's1', items: [summary, secondSummary] } }).catch(() => {});
  });
  await login(page);
  await page.goto('/customer/comparison?stream=s1&batch=b1&batch=b2');
  await page.getByRole('button', { name: 'Сравнить выбранные батчи', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Выбранные батчи сохранены');
  await page.getByRole('button', { name: 'Повторить сравнение', exact: true }).click();
  await expect(page.locator('app-comparison-table')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Сравнить выбранные батчи', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Загружаем сравнение…', exact: true }),
  ).toBeVisible();
  await expect.poll(() => !!release).toBe(true);
  await page.getByRole('checkbox').nth(1).uncheck();
  release!();
  await expect(page.locator('app-comparison-table')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Сравнить выбранные батчи', exact: true }),
  ).toBeDisabled();
});

test('команда читает отчёт выбранного заказчика, а ключ заказчика не открывает раздел команды', async ({
  page,
}) => {
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({ json: { role: 'admin', customer: null } }),
  );
  await page.route('**/api/v1/admin/customers', (r) =>
    r.fulfill({ json: { items: [{ customer_id: 'o1', name: 'Заказчик' }] } }),
  );
  await page.route('**/api/v1/customers/o1', (r) =>
    r.fulfill({ json: { customer_id: 'o1', name: 'Заказчик' } }),
  );
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('admin-test-key');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page).toHaveURL(/\/team\/batches$/);
  await page.getByRole('link', { name: /Отчёт/ }).click();
  await expect(page.getByRole('heading', { name: 'Сводный отчёт', exact: true })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('Заказчик');
  await page.getByRole('link', { name: 'c1.mp3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор звонка', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({ json: { role: 'customer', customer: { customer_id: 'o1', name: 'Заказчик' } } }),
  );
  await login(page);
  await page.goto('/team/batches/b1/report');
  await expect(page).toHaveURL(/\/customer\/batches$/);
  await expect(page.locator('app-report-summary')).toHaveCount(0);
});
