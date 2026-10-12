import { expect, test, Page } from '@playwright/test';
import { CRITERIA } from '../src/app/reports/report-models';
async function adminLogin(page: Page) {
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({ json: { role: 'admin', customer: null } }),
  );
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('controlled-admin');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page).toHaveURL(/\/team\/batches$/);
}
test('команда создаёт заказчика через REST и видит ключ только в результате создания', async ({
  page,
}) => {
  let created = false;
  await page.route('**/api/v1/admin/customers', (r) => {
    if (r.request().method() === 'POST') {
      expect(r.request().postDataJSON()).toEqual({ name: 'Новый заказчик' });
      created = true;
      return r.fulfill({
        status: 201,
        json: { customer_id: 'o1', name: 'Новый заказчик', api_key: 'new-customer-key' },
      });
    }
    return r.fulfill({
      json: { items: created ? [{ customer_id: 'o1', name: 'Новый заказчик' }] : [] },
    });
  });
  await adminLogin(page);
  await page.getByRole('link', { name: 'Заказчики', exact: true }).click();
  await page.getByLabel('Название заказчика', { exact: true }).fill('Новый заказчик');
  await page.getByRole('button', { name: 'Создать заказчика', exact: true }).click();
  await expect(page.getByLabel('API-ключ заказчика', { exact: true })).toHaveValue(
    'new-customer-key',
  );
  await expect(page.locator('body')).not.toContainText('Демонстрационный ключ');
  await page.getByRole('button', { name: 'Закрыть результат', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Новый заказчик');
  await expect(page.getByLabel('API-ключ заказчика', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('table')).toContainText('Новый заказчик');
  await expect(page.locator('input[value="new-customer-key"]')).toHaveCount(0);
});

const config = {
  name: 'Правила',
  whisper_model: 'whisper-large-v3',
  llm_model: 'kimi-k2.7-code',
  speech_lang: 'ru',
  whisper_prompt: '',
  role_prompt: 'Роли {fragments}',
  analysis_system_prompt: 'Оцени разговор',
  analysis_user_prompt: '{checklist}{kb}{metrics}{dialog}',
  long_pause_sec: 2,
  interruption_gap_sec: 0.2,
  speech_rate_enabled: true,
  unwanted_expressions_enabled: false,
  text_correction_enabled: false,
  zero_total_on_critical: true,
};
const criteria = CRITERIA.map((c) => ({ id: c.id, title: c.name }));
function snapshot(id = 's1', values = config) {
  return {
    stream_id: id,
    customer_id: 'o1',
    name: values.name,
    created_at: '2026-10-01T00:00:00Z',
    config: values,
    materials: { knowledge_base: { size_bytes: 12, sha256: 'abc' } },
    criteria,
  };
}
function publicStream(id = 's1') {
  return {
    stream_id: id,
    customer_id: 'o1',
    name: config.name,
    created_at: '2026-10-01T00:00:00Z',
    options: {
      speech_rate_enabled: true,
      unwanted_expressions_enabled: false,
      text_correction_enabled: false,
      zero_total_on_critical: true,
    },
    criteria,
  };
}
async function streamBackend(page: Page) {
  await page.route('**/api/v1/admin/stream-defaults', (r) =>
    r.fulfill({ json: { whisper_prompt: 'Исходная терминология' } }),
  );
  await page.route('**/api/v1/admin/customers', (r) =>
    r.fulfill({ json: { items: [{ customer_id: 'o1', name: 'Заказчик' }] } }),
  );
  await page.route('**/api/v1/streams?*', (r) => r.fulfill({ json: { items: [publicStream()] } }));
  await page.route('**/api/v1/batches?*', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/admin/streams/s1', (r) => r.fulfill({ json: snapshot() }));
}
async function fillProcessing(page: Page) {
  for (const label of [
    'Модель Whisper',
    'Язык речи',
    'Промпт распределения ролей',
    'Модель LLM',
    'Системный промпт LLM',
    'Пользовательский промпт LLM',
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Промпт Whisper', { exact: true })).toHaveValue(
    'Исходная терминология',
  );
  await page.getByLabel('Промпт Whisper', { exact: true }).fill('Термины заказчика');
}
test('команда создаёт реальный стрим с полным снимком промптов и файлов', async ({ page }) => {
  await streamBackend(page);
  let postedConfig: Record<string, unknown> | null = null;
  await page.route('**/api/v1/admin/customers/o1/streams', (r) => {
    const body = r.request().postDataBuffer()!.toString();
    expect(body).toContain('name="knowledge_base"; filename="kb.txt"');
    postedConfig = JSON.parse(/name="config"\r\n\r\n([^\r]+)/.exec(body)![1]);
    expect(postedConfig).toEqual({
      name: config.name,
      enabled_criteria: CRITERIA.map((c) => c.id),
      whisper_prompt: 'Термины заказчика',
      long_pause_sec: 2,
      interruption_gap_sec: 0.2,
      speech_rate_enabled: true,
      unwanted_expressions_enabled: false,
      text_correction_enabled: false,
      zero_total_on_critical: true,
    });
    return r.fulfill({ status: 201, json: snapshot('s2') });
  });
  await page.route('**/api/v1/admin/streams/s2', (r) => r.fulfill({ json: snapshot('s2') }));
  await adminLogin(page);
  await page.getByRole('link', { name: '≋ Стримы', exact: true }).click();
  await page.getByRole('link', { name: 'Создать стрим', exact: true }).click();
  await page.getByLabel('Название стрима', { exact: true }).fill('Правила');
  await fillProcessing(page);
  await page.getByLabel('Поиск нежелательных выражений', { exact: true }).uncheck();
  await page.getByLabel('Корректировка текста транскрипции', { exact: true }).uncheck();
  await page
    .getByLabel('База знаний', { exact: true })
    .setInputFiles({ name: 'kb.txt', mimeType: 'text/plain', buffer: Buffer.from('Правила') });
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(page).toHaveURL(/\/team\/streams\/s2\?organization=o1$/);
  await expect(page.locator('body')).toContainText('Снимок стрима');
  await expect(page.locator('body')).not.toContainText('Роли {fragments}');
  await expect(page.locator('body')).not.toContainText('{checklist}{kb}{metrics}{dialog}');
  await expect(page.locator('body')).not.toContainText('Демо проверяет');
  expect(postedConfig).not.toBeNull();
});

function batch(status = 'ready') {
  return {
    batch_id: 'b1',
    customer_id: 'o1',
    stream_id: 's1',
    upload_id: 'u1',
    name: 'Загрузка',
    archive_name: 'calls.zip',
    created_at: '2026-10-01T00:00:00Z',
    status,
    total_calls: 1,
    accepted_count: 1,
    duplicate_count: 0,
    rejected_count: 0,
    error: null,
  };
}
test('создание на основе старого подмножества передаёт все 11 фиксированных критериев', async ({
  page,
}) => {
  await streamBackend(page);
  const selected = ['1.1', '1.2'];
  const subset = {
    ...snapshot('s2'),
    criteria: criteria.filter((c) => selected.includes(c.id)),
    config: { ...config, enabled_criteria: selected, zero_total_on_critical: false },
  };
  await page.route('**/api/v1/admin/streams/s2', (r) => r.fulfill({ json: subset }));
  await page.route('**/api/v1/admin/streams/s3', (r) => r.fulfill({ json: snapshot('s3') }));
  await page.route('**/api/v1/admin/customers/o1/streams', (r) => {
    const body = r.request().postDataBuffer()!.toString();
    const sent = JSON.parse(/name="config"\r\n\r\n([^\r]+)/.exec(body)![1]);
    expect(sent.enabled_criteria).toEqual(CRITERIA.map((c) => c.id));
    expect(sent.zero_total_on_critical).toBe(false);
    return r.fulfill({ status: 201, json: snapshot('s3') });
  });
  await adminLogin(page);
  await page.goto('/team/streams/s2?organization=o1');
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('link', { name: 'Создать на основе стрима', exact: true }).click();
  await expect(page.locator('.stream-criteria input')).toHaveCount(0);
  await page.getByText('11 фиксированных критериев оценки', { exact: true }).click();
  await expect(page.locator('.stream-criteria li')).toHaveCount(11);
  await page.getByLabel('Поиск нежелательных выражений', { exact: true }).uncheck();
  await page.getByLabel('Корректировка текста транскрипции', { exact: true }).uncheck();
  await page
    .getByLabel('База знаний', { exact: true })
    .setInputFiles({ name: 'kb.txt', mimeType: 'text/plain', buffer: Buffer.from('Правила') });
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(page).toHaveURL(/\/team\/streams\/s3\?organization=o1$/);
  await expect(page.getByRole('listitem')).toHaveCount(11);
});

test('ручной запуск и повтор получают фактическое состояние того же батча', async ({ page }) => {
  await streamBackend(page);
  let status = 'ready',
    starts = 0;
  await page.route('**/api/v1/batches?*', (r) => r.fulfill({ json: { items: [batch(status)] } }));
  await page.route('**/api/v1/batches/b1', (r) => r.fulfill({ json: batch(status) }));
  await page.route('**/api/v1/batches/b1/files', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/streams/s1', (r) => r.fulfill({ json: publicStream() }));
  await page.route('**/api/v1/customers/o1', (r) =>
    r.fulfill({ json: { customer_id: 'o1', name: 'Заказчик' } }),
  );
  await page.route('**/api/v1/admin/batches/b1/start', (r) => {
    starts++;
    status = 'queued';
    return r.fulfill({ status: starts === 1 ? 202 : 200, json: batch(status) });
  });
  await adminLogin(page);
  await page.getByRole('button', { name: 'Поставить в очередь · Загрузка', exact: true }).click();
  await expect(page.locator('p[role=status]')).toContainText('поставлен в очередь');
  await page.getByRole('link', { name: 'Статус · Загрузка', exact: true }).click();
  await page.getByText('Повтор запроса запуска', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Повторить запрос запуска · Загрузка', exact: true })
    .click();
  await expect(page.locator('body')).toContainText('повтор не создаёт новое задание');
  await expect(page.locator('body')).toContainText('В очереди');
  expect(starts).toBe(2);
});

test('копирование требует новые материалы и оставляет исходный снимок неизменным', async ({
  page,
}) => {
  await streamBackend(page);
  let posted = false;
  await page.route('**/api/v1/admin/customers/o1/streams', (r) => {
    posted = true;
    const body = r.request().postDataBuffer()!.toString();
    expect(body).toContain('filename="copy-kb.txt"');
    expect(body).not.toContain('role_prompt');
    return r.fulfill({ status: 201, json: snapshot('s2', { ...config, name: 'Копия' }) });
  });
  await page.route('**/api/v1/admin/streams/s2', (r) =>
    r.fulfill({ json: snapshot('s2', { ...config, name: 'Копия' }) }),
  );
  await adminLogin(page);
  await page.goto('/team/streams/s1?organization=o1');
  await page.getByRole('link', { name: 'Создать на основе стрима', exact: true }).click();
  await expect(page.getByLabel('Промпт Whisper', { exact: true })).toHaveValue(
    config.whisper_prompt,
  );
  await page.getByLabel('Название стрима', { exact: true }).fill('Копия');
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(page.locator('body')).toContainText('Приложите непустой файл базы знаний');
  expect(posted).toBe(false);
  await page.getByLabel('База знаний', { exact: true }).setInputFiles({
    name: 'copy-kb.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Новые правила'),
  });
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(page).toHaveURL(/\/team\/streams\/s2\?organization=o1$/);
  await page.goto('/team/streams/s1?organization=o1');
  await expect(page.locator('body')).toContainText('Правила');
  await expect(page.locator('body')).not.toContainText('Копия');
});
for (const status of [409, 403])
  test(`отказ удаления ${status} сохраняет снимок и подтверждение`, async ({ page }) => {
    await streamBackend(page);
    let requests = 0;
    await page.route('**/api/v1/admin/streams/s1', (r) =>
      r.request().method() === 'DELETE'
        ? (requests++,
          r.fulfill({
            status,
            json: { error: { code: status === 409 ? 'stream_in_use' : 'forbidden' } },
          }))
        : r.fulfill({ json: snapshot() }),
    );
    await adminLogin(page);
    await page.goto('/team/streams/s1?organization=o1');
    await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
    expect(requests).toBe(0);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Будут удалены его батчи');
    await dialog.getByRole('button', { name: 'Удалить стрим и историю', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      status === 409 ? 'Стрим занят' : 'Недостаточно прав',
    );
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.locator('body')).toContainText('Снимок стрима');
    await expect(page.locator('body')).not.toContainText('Стрим удалён');
    expect(requests).toBe(1);
  });
test('успешное удаление очищает снимок после ответа сервера', async ({ page }) => {
  await streamBackend(page);
  let finish: () => void = () => {};
  const waited = new Promise<void>((resolve) => (finish = resolve));
  await page.route('**/api/v1/admin/streams/s1', async (r) => {
    if (r.request().method() === 'DELETE') {
      await waited;
      return r.fulfill({ status: 204 });
    }
    return r.fulfill({ json: snapshot() });
  });
  await adminLogin(page);
  await page.goto('/team/streams/s1?organization=o1');
  await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить стрим и историю', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('body')).toContainText('Снимок стрима');
  finish();
  await expect(page.getByRole('heading', { name: 'Стрим удалён', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Снимок стрима');
});
for (const code of [403, 409])
  test(`отказ запуска ${code} показывает серверные права или актуальное состояние`, async ({
    page,
  }) => {
    await streamBackend(page);
    let status = 'ready';
    await page.route('**/api/v1/batches?*', (r) => r.fulfill({ json: { items: [batch(status)] } }));
    await page.route('**/api/v1/batches/b1', (r) => r.fulfill({ json: batch(status) }));
    await page.route('**/api/v1/batches/b1/files', (r) => r.fulfill({ json: { items: [] } }));
    await page.route('**/api/v1/streams/s1', (r) => r.fulfill({ json: publicStream() }));
    await page.route('**/api/v1/customers/o1', (r) =>
      r.fulfill({ json: { customer_id: 'o1', name: 'Заказчик' } }),
    );
    await page.route('**/api/v1/admin/batches/b1/start', (r) => {
      status = 'uploading';
      return r.fulfill({
        status: code,
        json: { error: { code: code === 403 ? 'forbidden' : 'batch_not_ready' } },
      });
    });
    await adminLogin(page);
    await page.getByRole('button', { name: 'Поставить в очередь · Загрузка', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      code === 403 ? 'Недостаточно прав' : 'запуск отклонён',
    );
    if (code === 409) await expect(page.getByRole('table')).toContainText('Загружается');
  });
test('ошибка проверки материала сохраняет все поля и файлы для исправления', async ({ page }) => {
  await streamBackend(page);
  let posts = 0;
  await page.route('**/api/v1/admin/customers/o1/streams', (r) => {
    posts++;
    return r.fulfill({
      status: 422,
      json: { error: { code: 'invalid_material', message: 'bad file' } },
    });
  });
  await adminLogin(page);
  await page.goto('/team/streams/new?organization=o1');
  await page.getByLabel('Название стрима', { exact: true }).fill('Правила');
  await fillProcessing(page);
  await page.getByLabel('Поиск нежелательных выражений', { exact: true }).uncheck();
  await page.getByLabel('Корректировка текста транскрипции', { exact: true }).uncheck();
  await page
    .getByLabel('База знаний', { exact: true })
    .setInputFiles({ name: 'kb.txt', mimeType: 'text/plain', buffer: Buffer.from('Правила') });
  await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сервер отклонил настройки или материалы');
  await expect(page.getByLabel('Промпт Whisper', { exact: true })).toHaveValue('Термины заказчика');
  await expect(page.getByLabel('База знаний', { exact: true })).toHaveValue(/kb.txt$/);
  await page.getByRole('button', { name: 'Повторить создание', exact: true }).click();
  await expect.poll(() => posts).toBe(2);
});

test('потерянное подтверждение запуска повторяется с прежним ID и показывает текущую очередь', async ({
  page,
}) => {
  await streamBackend(page);
  let status = 'ready',
    starts = 0;
  await page.route('**/api/v1/batches?*', (r) => r.fulfill({ json: { items: [batch(status)] } }));
  await page.route('**/api/v1/batches/b1', (r) => r.fulfill({ json: batch(status) }));
  await page.route('**/api/v1/batches/b1/files', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/streams/s1', (r) => r.fulfill({ json: publicStream() }));
  await page.route('**/api/v1/customers/o1', (r) =>
    r.fulfill({ json: { customer_id: 'o1', name: 'Заказчик' } }),
  );
  await page.route('**/api/v1/admin/batches/b1/start', (r) => {
    starts++;
    status = 'queued';
    return starts === 1 ? r.abort('failed') : r.fulfill({ status: 200, json: batch(status) });
  });
  await adminLogin(page);
  await page.getByRole('button', { name: 'Поставить в очередь · Загрузка', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Повторите запрос с тем же ID батча');
  await page.getByRole('button', { name: 'Повторить постановку · Загрузка', exact: true }).click();
  await expect(page.locator('p[role=status]')).toContainText('повтор не создаёт новое задание');
  await expect(page.getByRole('table')).toContainText('В очереди');
  expect(starts).toBe(2);
});

test('полный снимок сохраняет точность числовых порогов', async ({ page }) => {
  await streamBackend(page);
  await page.route('**/api/v1/admin/streams/s1', (r) =>
    r.fulfill({ json: snapshot('s1', { ...config, interruption_gap_sec: 0.0001 }) }),
  );
  await adminLogin(page);
  await page.goto('/team/streams/s1?organization=o1');
  await expect(page.locator('body')).toContainText('0,0001');
});
test('серверный отказ названия заказчика связан с полем без сообщений о промптах', async ({
  page,
}) => {
  await streamBackend(page);
  await page.route('**/api/v1/admin/customers', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ status: 422, json: { error: { code: 'invalid_request' } } })
      : r.fulfill({ json: { items: [] } }),
  );
  await adminLogin(page);
  await page.getByRole('link', { name: 'Заказчики', exact: true }).click();
  await page.getByLabel('Название заказчика', { exact: true }).fill('Название');
  await page.getByRole('button', { name: 'Создать заказчика', exact: true }).click();
  await expect(page.getByLabel('Название заказчика', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.locator('#customer-name-error')).toContainText('Сервер отклонил название');
  await expect(page.locator('body')).not.toContainText('промптов');
  await expect(page.getByLabel('Название заказчика', { exact: true })).toHaveValue('Название');
  await page.getByLabel('Название заказчика', { exact: true }).fill('Исправленное');
  await expect(page.locator('#customer-name-error')).toHaveCount(0);
});

test('ошибка загрузки исходного Whisper скрывает форму и позволяет повторить', async ({ page }) => {
  await streamBackend(page);
  let fail = true;
  await page.route('**/api/v1/admin/stream-defaults', (r) =>
    fail
      ? r.fulfill({ status: 503, json: { error: { code: 'unavailable' } } })
      : r.fulfill({ json: { whisper_prompt: 'Из backend' } }),
  );
  await adminLogin(page);
  await page.goto('/team/streams/new?organization=o1');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить настройки');
  await expect(page.getByLabel('Название стрима', { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Промпт Whisper', { exact: true })).toHaveValue('Из backend');
});
