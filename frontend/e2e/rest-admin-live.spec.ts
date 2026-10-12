import { expect, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import path from 'node:path';

test.use({ trace: 'off' }); // One-time API keys must not enter traces.
test('живой admin: заказчик, снимок, копия, повтор запуска, busy и каскадное удаление', async ({
  page,
  request,
}, testInfo) => {
  test.skip(process.env['VOX_LIVE_ADMIN'] !== '1', 'Opt-in with isolated backend and real ffprobe');
  test.setTimeout(90_000);
  const backend = path.resolve('../backend');
  const python = path.join(backend, '.venv-backend/Scripts/python.exe');
  const target = process.env['VOX_API_TARGET'] ?? 'http://127.0.0.1:8775';
  const url = new URL(target);
  expect(url.hostname).toBe('127.0.0.1');
  const root = await mkdtemp(path.join(tmpdir(), 'vox-frontend15-'));
  const key = randomUUID();
  const probe = spawnSync(
    python,
    [
      '-c',
      'from backend.config import BackendSettings; print(BackendSettings(admin_api_key="test-admin-key-not-for-production").ffprobe_path)',
    ],
    {
      cwd: backend,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    },
  );
  expect(probe.status).toBe(0);
  const server = spawn(
    python,
    [
      '-m',
      'uvicorn',
      'backend.api:create_app',
      '--factory',
      '--host',
      '127.0.0.1',
      '--port',
      url.port,
    ],
    {
      cwd: backend,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        VOX_ADMIN_API_KEY: key,
        VOX_DATABASE_PATH: path.join(root, 'api.sqlite3'),
        VOX_MATERIALS_ROOT: path.join(root, 'materials'),
        VOX_INPUTS_ROOT: path.join(root, 'inputs'),
        VOX_WORKER_LOCK: path.join(root, 'worker.lock'),
        VOX_FFPROBE_PATH: probe.stdout.trim(),
        WHISPER_BASE_URL: 'http://127.0.0.1:1/v1',
        GPL_BASE_URL: 'http://127.0.0.1:1/v1',
        WHISPER_API_KEY: 'unavailable',
        GPL_API_KEY: 'unavailable',
      },
    },
  );
  try {
    await expect
      .poll(
        async () => {
          try {
            return server.exitCode === null && (await request.get(target + '/openapi.json')).ok();
          } catch {
            return false;
          }
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await page.goto('/connect');
    await page.getByLabel('API-ключ', { exact: true }).fill(key);
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    await page.getByRole('link', { name: 'Заказчики', exact: true }).click();
    await page
      .getByLabel('Название заказчика', { exact: true })
      .fill('Приёмка административных операций');
    await page.getByRole('button', { name: 'Создать заказчика', exact: true }).click();
    const customerKey = await page.getByLabel('API-ключ заказчика', { exact: true }).inputValue();
    expect(customerKey.length).toBeGreaterThan(10);
    const admin = { Authorization: 'Bearer ' + key },
      owner = { Authorization: 'Bearer ' + customerKey };
    const owners = await (
      await request.get(target + '/v1/admin/customers', { headers: admin })
    ).json();
    expect(owners.items).toHaveLength(1);
    expect(owners.items[0]).not.toHaveProperty('api_key');
    const customerId = owners.items[0].customer_id;
    await page.getByRole('button', { name: 'Закрыть результат', exact: true }).click();
    await page.reload();
    await expect(page.getByLabel('API-ключ заказчика', { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Стримы', exact: true }).click();
    await page.getByRole('link', { name: 'Создать стрим', exact: true }).click();
    await page.getByLabel('Название стрима', { exact: true }).fill('Правила приёмки');
    const defaultsResponse = await request.get(target + '/v1/admin/stream-defaults', {
      headers: admin,
    });
    expect(defaultsResponse.ok()).toBe(true);
    const defaults = await defaultsResponse.json();
    await expect(page.getByLabel('Промпт Whisper', { exact: true })).toHaveValue(
      defaults.whisper_prompt,
    );
    for (const label of [
      'Модель Whisper',
      'Язык речи',
      'Промпт распределения ролей',
      'Модель LLM',
      'Системный промпт LLM',
      'Пользовательский промпт LLM',
    ])
      await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
    await page.getByLabel('Промпт Whisper', { exact: true }).fill('Термины приёмки');
    await page.getByLabel('База знаний', { exact: true }).setInputFiles({
      name: 'kb.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Правила приёмки'),
    });
    await page.getByLabel('Словарь нежелательных выражений', { exact: true }).setInputFiles({
      name: 'unwanted.json',
      mimeType: 'application/json',
      buffer: Buffer.from('["грубость"]'),
    });
    await page.getByLabel('Словарь корректировки текста', { exact: true }).setInputFiles({
      name: 'corrections.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"ошпка":"ошибка"}'),
    });
    await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
    await expect(page.getByRole('heading', { name: '1. Транскрибация через Whisper', exact: true })).toBeVisible();
    const originalId = new URL(page.url()).pathname.split('/').at(-1)!;
    const original = await (
      await request.get(`${target}/v1/admin/streams/${originalId}`, { headers: admin })
    ).json();
    expect(original.config.whisper_prompt).toBe('Термины приёмки');
    expect(original.config.role_prompt).toContain('SPEAKER_00');
    expect(original.config.analysis_user_prompt).toContain('{checklist}');
    expect(Object.keys(original.materials)).toHaveLength(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('link', { name: 'Создать на основе стрима', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('admin-stream-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('link', { name: 'Создать на основе стрима', exact: true }).click();
    await expect(page.getByLabel('Промпт Whisper', { exact: true })).toHaveValue(
      original.config.whisper_prompt,
    );
    await page.getByLabel('Название стрима', { exact: true }).fill('Копия правил');
    await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
    await expect(page.locator('body')).toContainText('Приложите непустой файл базы знаний');
    await page.getByLabel('База знаний', { exact: true }).setInputFiles({
      name: 'kb-copy.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Новые правила'),
    });
    await page.getByLabel('Словарь нежелательных выражений', { exact: true }).setInputFiles({
      name: 'unwanted.json',
      mimeType: 'application/json',
      buffer: Buffer.from('["грубость"]'),
    });
    await page.getByLabel('Словарь корректировки текста', { exact: true }).setInputFiles({
      name: 'corrections.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"ошпка":"ошибка"}'),
    });
    await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
    await expect(page.getByRole('heading', { name: '1. Транскрибация через Whisper', exact: true })).toBeVisible();
    const copyId = new URL(page.url()).pathname.split('/').at(-1)!;
    expect(copyId).not.toBe(originalId);
    const archivePath = path.join(root, 'call.zip');
    expect(
      spawnSync(
        python,
        [
          '-c',
          'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"call.mp3"); z.close()',
          archivePath,
          path.join(backend, 'call_002.mp3'),
        ],
        { windowsHide: true },
      ).status,
    ).toBe(0);
    const upload = async (streamId: string) => {
      const response = await request.post(target + '/v1/batch-archives', {
        headers: owner,
        multipart: {
          stream_id: streamId,
          upload_id: randomUUID(),
          archive: {
            name: 'call.zip',
            mimeType: 'application/zip',
            buffer: await (await import('node:fs/promises')).readFile(archivePath),
          },
        },
      });
      expect(response.status()).toBe(201);
      const batch = await response.json();
      expect(batch.status).toBe('ready');
      return batch.batch_id as string;
    };
    const originalBatch = await upload(originalId),
      copyBatch = await upload(copyId);
    await page.goto(`/team/batches?organization=${customerId}&stream=${originalId}`);
    await page.getByRole('button', { name: /^Поставить в очередь/ }).click();
    await expect(page.locator('p[role=status]')).toContainText('поставлен в очередь');
    await page.getByRole('link', { name: /^Статус/ }).click();
    await page.getByText('Повтор запроса запуска', { exact: true }).click();
    await page.getByRole('button', { name: /^Повторить запрос запуска/ }).click();
    await expect(page.locator('body')).toContainText('повтор не создаёт новое задание');
    expect(
      (
        await (
          await request.get(`${target}/v1/batches/${originalBatch}`, { headers: admin })
        ).json()
      ).status,
    ).toBe('queued');
    // A queued job can be removed; active intake is the actual busy contract.
    const openBatch = await request.post(target + '/v1/batches', {
      headers: owner,
      data: { stream_id: originalId, upload_id: randomUUID() },
    });
    expect(openBatch.status()).toBe(201);
    expect((await openBatch.json()).status).toBe('uploading');
    await page.goto(`/team/streams/${originalId}?organization=${customerId}`);
    await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
    await page.getByRole('button', { name: 'Удалить стрим и историю', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Стрим занят');
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.goto(`/team/streams/${copyId}?organization=${customerId}`);
    await page.getByRole('button', { name: 'Удалить стрим', exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath('admin-delete-desktop.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Удалить стрим и историю', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Стрим удалён', exact: true })).toBeVisible();
    expect((await request.get(`${target}/v1/streams/${copyId}`, { headers: admin })).status()).toBe(
      404,
    );
    expect(
      (await request.get(`${target}/v1/batches/${copyBatch}`, { headers: admin })).status(),
    ).toBe(404);
    expect(
      (await request.get(`${target}/v1/streams/${originalId}`, { headers: admin })).status(),
    ).toBe(200);
    expect(
      (
        await request.post(`${target}/v1/admin/batches/${originalBatch}/start`, { headers: owner })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.delete(`${target}/v1/admin/streams/${originalId}`, { headers: owner })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post(target + '/v1/admin/customers', {
          headers: owner,
          data: { name: 'Запрещённый' },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await request.get(`${target}/v1/admin/streams/${originalId}`, { headers: owner })).status(),
    ).toBe(403);
    expect(
      (
        await request.post(`${target}/v1/admin/customers/${customerId}/streams`, {
          headers: owner,
          multipart: {
            config: '{}',
            knowledge_base: { name: 'kb.txt', mimeType: 'text/plain', buffer: Buffer.from('KB') },
          },
        })
      ).status(),
    ).toBe(403);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.getByLabel('API-ключ', { exact: true }).fill(customerKey);
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    await expect(page).toHaveURL(/\/customer\/batches$/);
    await page.goto('/team/customers');
    await expect(page).toHaveURL(/\/customer\/batches$/);
    await expect(page.getByRole('link', { name: 'Заказчики', exact: true })).toHaveCount(0);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const ended = once(server, 'exit');
      server.kill();
      await ended;
    }
    const resolved = path.resolve(root);
    expect(path.dirname(resolved)).toBe(path.resolve(tmpdir()));
    expect(path.basename(resolved)).toMatch(/^vox-frontend15-/);
    await rm(resolved, { recursive: true, force: true });
  }
});
