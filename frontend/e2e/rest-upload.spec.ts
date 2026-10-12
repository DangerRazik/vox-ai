import { expect, test } from '@playwright/test';

const stream = {
  stream_id: 's1',
  customer_id: 'o1',
  name: 'Поддержка',
  created_at: '2026-10-01T00:00:00Z',
  options: {
    speech_rate_enabled: true,
    zero_total_on_critical: true,
    text_correction_enabled: false,
    unwanted_expressions_enabled: false,
  },
  criteria: [],
};
test('рабочая ZIP-загрузка отправляет multipart и показывает частичный приём без запуска анализа', async ({
  page,
}) => {
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({ json: { role: 'customer', customer: { customer_id: 'o1', name: 'Заказчик' } } }),
  );
  await page.route('**/api/v1/streams?*', (r) => r.fulfill({ json: { items: [stream] } }));
  await page.route('**/api/v1/batches?*', (r) => r.fulfill({ json: { items: [] } }));
  let uploadId = '';
  await page.route('**/api/v1/batch-archives', (r) => {
    const content = r.request().postDataBuffer()!.toString('utf8');
    expect(r.request().headers()['content-type']).toContain('multipart/form-data');
    expect(content).toContain('name="archive"; filename="calls.zip"');
    expect(content).toContain('name="stream_id"\r\n\r\ns1');
    expect(content).not.toContain('name="customer_id"');
    uploadId = /name="upload_id"\r\n\r\n([^\r]+)/.exec(content)![1];
    return r.fulfill({
      status: 201,
      json: {
        batch_id: 'b1',
        customer_id: 'o1',
        stream_id: 's1',
        upload_id: uploadId,
        created_at: '2026-10-01T00:00:00Z',
        status: 'ready',
        total_calls: 1,
        items: [
          { status: 'accepted', original_name: 'call.wav', call_id: 'c1' },
          {
            status: 'duplicate',
            original_name: 'copy.wav',
            call_id: 'c1',
            duplicate_of: 'call.wav',
          },
          {
            status: 'rejected',
            original_name: 'bad.wav',
            error: { code: 'invalid_audio', message: 'Invalid audio' },
          },
        ],
      },
    });
  });
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('test-key');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/batches$/);
  await page.getByRole('link', { name: 'Загрузить ZIP', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Начать новую загрузку|Загрузить ещё ZIP/ }),
  ).toHaveCount(0);
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'calls.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('controlled archive'),
  });
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результаты приёма', exact: true })).toContainText(
    'Принято уникальных записей: 1',
  );
  await expect(page.locator('body')).toContainText('Дубликаты: 1');
  await expect(page.locator('body')).toContainText('Ошибки файлов: 1');
  await expect(page.locator('body')).toContainText('Ожидает ручного запуска командой Vox AI');
  await expect(page.getByTestId('upload-id')).toHaveText(uploadId);
  await expect(page.locator('body')).not.toContainText('Локальная имитация');
});
import { Page } from '@playwright/test';
async function recoveryBackend(page: Page) {
  let status = 'batch_failed';
  const batch = () => ({
    batch_id: 'b1',
    customer_id: 'o1',
    stream_id: 's1',
    upload_id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-10-01T00:00:00Z',
    status,
    total_calls: 1,
    error: 'batch_processing_failed',
  });
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({ json: { role: 'customer', customer: { customer_id: 'o1', name: 'Заказчик' } } }),
  );
  await page.route('**/api/v1/streams/s1', (r) => r.fulfill({ json: stream }));
  await page.route('**/api/v1/batches/b1', (r) => r.fulfill({ json: batch() }));
  await page.route('**/api/v1/batches/b1/files', (r) =>
    r.fulfill({
      json: { items: [{ status: 'accepted', original_name: 'original.wav', call_id: 'c1' }] },
    }),
  );
  return { batch, setStatus: (value: string) => (status = value) };
}
test('ZIP-восстановление показывает конфликт, сохраняет файлы и использует прежний стрим и ID после обновления', async ({
  page,
}) => {
  const backend = await recoveryBackend(page);
  let attempts = 0;
  await page.route('**/api/v1/batch-archives', (r) => {
    const body = r.request().postDataBuffer()!.toString();
    expect(body).toContain('11111111-1111-4111-8111-111111111111');
    expect(body).toContain('name="stream_id"\r\n\r\ns1');
    attempts++;
    if (attempts === 1) {
      backend.setStatus('restoring');
      return r.fulfill({
        status: 409,
        json: { error: { code: 'composition_conflict', message: 'conflict' } },
      });
    }
    backend.setStatus('ready');
    return r.fulfill({
      json: {
        ...backend.batch(),
        items: [{ status: 'accepted', original_name: 'original.wav', call_id: 'c1' }],
      },
    });
  });
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('test-key');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await page.goto('/customer/batches/b1/state');
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'wrong.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('controlled'),
  });
  await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
  await expect(page.locator('body')).toContainText('Состав записей расходится');
  await expect(page.getByLabel('Загрузить ZIP', { exact: true })).toHaveValue(/wrong.zip$/);
  await page.reload();
  await expect(page.getByTestId('upload-id')).toHaveText('11111111-1111-4111-8111-111111111111');
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles({
    name: 'original.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('controlled original'),
  });
  await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Восстановление завершено' })).toBeVisible();
  await expect(page.getByTestId('batch-id')).toHaveText('b1');
  expect(attempts).toBe(2);
});
async function uploadBackend(page: Page) {
  await page.route('**/api/v1/access-context', (r) =>
    r.fulfill({ json: { role: 'customer', customer: { customer_id: 'o1', name: 'Заказчик' } } }),
  );
  await page.route('**/api/v1/streams?*', (r) => r.fulfill({ json: { items: [stream] } }));
  await page.goto('/connect');
  await page.getByLabel('API-ключ', { exact: true }).fill('test-key');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page).toHaveURL(/customer\/batches$/);
  await page.goto('/customer/upload');
  await expect(page.getByTestId('upload-id')).toBeVisible();
}
const archiveFile = {
  name: 'calls.zip',
  mimeType: 'application/zip',
  buffer: Buffer.from('controlled archive'),
};
test('неудачный приём ZIP и обновление страницы дают компактный повтор с тем же ID', async ({
  page,
}) => {
  let uploadId = '';
  let posts = 0;
  const failed = () => ({
    ...acceptedBatch(uploadId, 'upload_failed'),
    total_calls: 0,
    error: 'no_accepted_records',
    items: [
      {
        status: 'rejected',
        original_name: 'nested.zip',
        error: { code: 'invalid_audio', message: 'Invalid audio' },
      },
    ],
  });
  await page.route('**/api/v1/batches?*', (r) =>
    r.fulfill({ json: { items: uploadId ? [failed()] : [] } }),
  );
  await page.route('**/api/v1/batches/b1/files', (r) =>
    r.fulfill({ json: { items: failed().items } }),
  );
  await page.route('**/api/v1/batch-archives', (r) => {
    const id = requestId(r.request().postDataBuffer()!.toString());
    if (posts++) {
      expect(id).toBe(uploadId);
      return r.fulfill({ json: acceptedBatch(id) });
    }
    uploadId = id;
    return r.abort('failed');
  });
  await uploadBackend(page);
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archiveFile);
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  const notice = page.getByRole('alert').filter({ hasText: 'ZIP не принят' });
  await expect(notice).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загрузить', exact: true })).toBeEnabled();
  await page.reload();
  await expect(notice).toBeVisible();
  await expect(page.getByTestId('upload-id')).toHaveText(uploadId);
  await expect(page.locator('body')).not.toContainText('Ошибка приёма');
  await expect(page.locator('body')).not.toContainText('Продолжаем прежнюю загрузку');
  await expect(page.locator('body')).toContainText(
    'nested.zip — Ошибка: Файл не удалось прочитать как аудио.',
  );
  const noticeBox = (await notice.boundingBox())!;
  expect(noticeBox.height).toBeLessThan(180);
  const submitBox = (await page
    .getByRole('button', { name: 'Загрузить', exact: true })
    .boundingBox())!;
  const actionsBox = (await page
    .getByRole('button', { name: 'Начать новую загрузку', exact: true })
    .boundingBox())!;
  expect(actionsBox.y - (submitBox.y + submitBox.height)).toBeLessThan(50);
  await page.screenshot({
    path: test.info().outputPath('upload-error-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('upload-error-mobile.png'),
    fullPage: true,
  });
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archiveFile);
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(page.locator('body')).toContainText('Ожидает ручного запуска командой Vox AI');
  await expect(notice).toHaveCount(0);
  expect(posts).toBe(2);
});
function requestId(body: string) {
  return /name="upload_id"\r\n\r\n([^\r]+)/.exec(body)![1];
}
function acceptedBatch(uploadId: string, status = 'ready') {
  return {
    batch_id: 'b1',
    customer_id: 'o1',
    stream_id: 's1',
    upload_id: uploadId,
    created_at: '2026-10-01T00:00:00Z',
    status,
    total_calls: 1,
    items: [{ status: 'accepted', original_name: 'call.wav', call_id: 'c1' }],
  };
}

test('потерянный ответ подтверждается чтением сервера, обновление сохраняет ID, новая загрузка меняет ID', async ({
  page,
}) => {
  let uploadId = '';
  let posts = 0;
  await page.route('**/api/v1/batches?*', (r) =>
    r.fulfill({ json: { items: uploadId ? [acceptedBatch(uploadId)] : [] } }),
  );
  await page.route('**/api/v1/batches/b1/files', (r) =>
    r.fulfill({ json: { items: acceptedBatch(uploadId).items } }),
  );
  await page.route('**/api/v1/batch-archives', (r) => {
    posts++;
    uploadId = requestId(r.request().postDataBuffer()!.toString());
    return r.abort('failed');
  });
  await uploadBackend(page);
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archiveFile);
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(page.locator('body')).toContainText('Ожидает ручного запуска командой Vox AI');
  expect(posts).toBe(1);
  await page.reload();
  await expect(page.getByTestId('upload-id')).toHaveText(uploadId);
  await expect(page.getByRole('region', { name: 'Результаты приёма', exact: true })).toContainText(
    'call.wav',
  );
  expect(posts).toBe(1);
  await page.getByRole('button', { name: 'Загрузить ещё ZIP', exact: true }).click();
  await expect(page.getByTestId('upload-id')).not.toHaveText(uploadId);
});

test('неопределённое состояние блокирует передачу, после обновления повтор сохраняет ID', async ({
  page,
}) => {
  const ids: string[] = [];
  let lookupUnavailable = false;
  await page.route('**/api/v1/batches?*', (r) =>
    lookupUnavailable ? r.abort('failed') : r.fulfill({ json: { items: [] } }),
  );
  await page.route('**/api/v1/batch-archives', (r) => {
    ids.push(requestId(r.request().postDataBuffer()!.toString()));
    if (ids.length === 1) {
      lookupUnavailable = true;
      return r.abort('failed');
    }
    return r.fulfill({ json: acceptedBatch(ids[1]) });
  });
  await uploadBackend(page);
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archiveFile);
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Проверить состояние', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Загрузить', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: /Начать новую загрузку|Загрузить ещё ZIP/ }),
  ).toHaveCount(0);
  lookupUnavailable = false;
  await page.reload();
  await expect(page.getByTestId('upload-id')).toHaveText(ids[0]);
  await expect(page.getByRole('button', { name: 'Загрузить', exact: true })).toBeEnabled();
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archiveFile);
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(page.locator('body')).toContainText('Ожидает ручного запуска командой Vox AI');
  expect(ids[1]).toBe(ids[0]);
});

test('серверный отказ ZIP позволяет заменить архив и повторить тот же ID без метаданных', async ({
  page,
}) => {
  const ids: string[] = [];
  await page.route('**/api/v1/batches?*', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/batch-archives', (r) => {
    const body = r.request().postDataBuffer()!.toString();
    ids.push(requestId(body));
    expect(body).not.toContain('name="metadata_file"');
    return ids.length === 1
      ? r.fulfill({
          status: 422,
          json: { error: { code: 'encrypted_archive', message: 'invalid' } },
        })
      : r.fulfill({ json: acceptedBatch(ids[1]) });
  });
  await uploadBackend(page);
  await expect(page.getByLabel('JSON-метаданные (необязательно)', { exact: true })).toHaveCount(0);
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archiveFile);
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(page.locator('#archive-error')).toContainText('Нужен ZIP без пароля');
  await page
    .getByLabel('Загрузить ZIP', { exact: true })
    .setInputFiles({ ...archiveFile, name: 'fixed.zip' });
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(page.locator('body')).toContainText('Ожидает ручного запуска командой Vox AI');
  expect(ids[1]).toBe(ids[0]);
});

test('новая ZIP-загрузка из списка изолирована от ошибки и восстановления предыдущего батча', async ({
  page,
}) => {
  const ids: string[] = [];
  let restored = false;
  const oldBatch = () => ({
    ...acceptedBatch(ids[0], restored ? 'ready' : 'upload_failed'),
    total_calls: restored ? 1 : 0,
    error: restored ? null : 'no_accepted_records',
    items: restored
      ? [{ status: 'accepted', original_name: 'fixed.wav' }]
      : [
          {
            status: 'rejected',
            original_name: 'nested.zip',
            error: { code: 'invalid_audio', message: 'Invalid audio' },
          },
        ],
  });
  await page.route('**/api/v1/batches?*', (r) =>
    r.fulfill({ json: { items: ids.length ? [oldBatch()] : [] } }),
  );
  await page.route('**/api/v1/streams/s1', (r) => r.fulfill({ json: stream }));
  await page.route('**/api/v1/batches/b1', (r) => r.fulfill({ json: oldBatch() }));
  await page.route('**/api/v1/batches/b1/files', (r) =>
    r.fulfill({ json: { items: oldBatch().items } }),
  );
  await page.route('**/api/v1/batch-archives', (r) => {
    const id = requestId(r.request().postDataBuffer()!.toString());
    ids.push(id);
    if (ids.length === 1) return r.fulfill({ json: oldBatch() });
    if (ids.length === 2) {
      expect(id).not.toBe(ids[0]);
      return r.fulfill({ json: { ...acceptedBatch(id), batch_id: 'b2' } });
    }
    expect(id).toBe(ids[0]);
    restored = true;
    return r.fulfill({ json: oldBatch() });
  });
  await uploadBackend(page);
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archiveFile);
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ZIP не принят' })).toBeVisible();
  const oldSession = page.url();
  await page.getByRole('link', { name: 'К списку батчей', exact: true }).click();
  await page.getByRole('link', { name: /^Восстановить/ }).click();
  await expect(page.getByTestId('upload-id')).toHaveText(ids[0]);
  await expect(page.getByRole('button', { name: 'Повторить импорт', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'К списку батчей', exact: true }).click();
  await page.getByRole('link', { name: 'Загрузить ZIP', exact: true }).click();
  const freshId = await page.getByTestId('upload-id').textContent();
  expect(freshId).not.toBe(ids[0]);
  await expect(page.getByLabel('Стрим', { exact: true })).toHaveValue('s1');
  await expect(page.getByRole('region', { name: 'Результаты приёма', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('ZIP не принят');
  await page.reload();
  await expect(page.getByTestId('upload-id')).toHaveText(freshId!);
  await expect(page.getByRole('region', { name: 'Результаты приёма', exact: true })).toHaveCount(0);
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archiveFile);
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  await expect(page.locator('body')).toContainText('Ожидает ручного запуска командой Vox AI');
  expect(ids[1]).toBe(freshId);
  // Новая форма не затирает черновик предыдущей загрузки.
  await page.goto(oldSession);
  await expect(page.getByTestId('upload-id')).toHaveText(ids[0]);
  await expect(page.getByRole('heading', { name: 'ZIP не принят' })).toBeVisible();
  await page.getByRole('link', { name: 'К списку батчей', exact: true }).click();
  await page.getByRole('link', { name: /^Восстановить/ }).click();
  await expect(page.getByTestId('upload-id')).toHaveText(ids[0]);
  await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archiveFile);
  await page.getByRole('button', { name: 'Повторить импорт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Восстановление завершено' })).toBeVisible();
  await expect(page.getByTestId('batch-id')).toHaveText('b1');
  expect(ids).toEqual([ids[0], freshId, ids[0]]);
});
