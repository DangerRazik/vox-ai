import { expect, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import path from 'node:path';

test.use({ trace: 'off' }); // Temporary keys must not be retained in traces.
test('живой ZIP: частичный приём, повтор и восстановление того же батча без моделей', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    process.env['VOX_LIVE_UPLOAD'] !== '1',
    'Opt-in with isolated backend, real audio and ffprobe',
  );
  test.setTimeout(60_000);
  const backend = path.resolve('../backend');
  const python =
    process.env['VOX_BACKEND_PYTHON'] ?? path.join(backend, '.venv-backend/Scripts/python.exe');
  const target = process.env['VOX_API_TARGET'] ?? 'http://127.0.0.1:8765';
  const url = new URL(target);
  expect(url.hostname).toBe('127.0.0.1');
  const root = await mkdtemp(path.join(tmpdir(), 'vox-frontend14-'));
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
  const env = {
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
  };
  const processes: ReturnType<typeof spawn>[] = [];
  const run = (args: string[]) => {
    const child = spawn(python, args, { cwd: backend, env, windowsHide: true, stdio: 'ignore' });
    processes.push(child);
    return child;
  };
  const stop = async (child: ReturnType<typeof spawn>) => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill();
      await ended;
    }
  };
  try {
    const server = run([
      '-m',
      'uvicorn',
      'backend.api:create_app',
      '--factory',
      '--host',
      '127.0.0.1',
      '--port',
      url.port,
    ]);
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
    const admin = { Authorization: 'Bearer ' + key };
    const created = await request.post(target + '/v1/admin/customers', {
      headers: admin,
      data: { name: 'Приёмка ZIP №14' },
    });
    expect(created.status()).toBe(201);
    const customer = await created.json();
    const config = {
      name: 'Проверка восстановления',
      whisper_model: 'whisper-large-v3',
      llm_model: 'kimi-k2.7-code',
      speech_lang: 'ru',
      role_prompt: 'Роли {fragments}',
      analysis_system_prompt: 'Оцени',
      analysis_user_prompt: '{checklist}{kb}{metrics}{dialog}',
    };
    const streamResponse = await request.post(
      `${target}/v1/admin/customers/${customer.customer_id}/streams`,
      {
        headers: admin,
        multipart: {
          config: JSON.stringify(config),
          knowledge_base: {
            name: 'kb.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Правила'),
          },
        },
      },
    );
    expect(streamResponse.status()).toBe(201);
    const stream = await streamResponse.json();
    const archivePath = path.join(root, 'calls.zip');
    const archive = spawnSync(
      python,
      [
        '-c',
        'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"call.mp3"); z.write(sys.argv[2],"copy.mp3"); z.writestr("bad.txt",b"not audio"); z.close()',
        archivePath,
        path.join(backend, 'call_002.mp3'),
      ],
      { windowsHide: true },
    );
    expect(archive.status).toBe(0);
    let browserStarts = 0;
    page.on('request', (r) => {
      if (/\/admin\/.*\/start|\/audio\/transcriptions|\/chat\/completions/.test(r.url()))
        browserStarts++;
    });
    await page.goto('/connect');
    await page.getByLabel('API-ключ', { exact: true }).fill(customer.api_key);
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    await page.getByRole('link', { name: 'Загрузить ZIP', exact: true }).click();
    const uploadId = await page.getByTestId('upload-id').textContent();
    await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archivePath);
    await expect(page.getByLabel('JSON-метаданные (необязательно)', { exact: true })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
    const intake = page.getByRole('region', { name: 'Результаты приёма', exact: true });
    await expect(intake).toContainText('Принято уникальных записей: 1');
    await expect(intake).toContainText('Дубликаты: 1');
    await expect(intake).toContainText('Ошибки файлов: 1');
    await expect(intake).toContainText('Ожидает ручного запуска');
    const owner = { Authorization: 'Bearer ' + customer.api_key };
    const batches = await (await request.get(target + '/v1/batches', { headers: owner })).json();
    expect(batches.items).toHaveLength(1);
    const batch = batches.items[0];
    expect(batch.upload_id).toBe(uploadId);
    expect(batch.name).toBe('calls');
    expect(batch.archive_name).toBe('calls.zip');
    const files = await (
      await request.get(`${target}/v1/batches/${batch.batch_id}/files`, { headers: owner })
    ).json();
    expect(
      files.items.find((i: { status: string }) => i.status === 'accepted').external_employee_id,
    ).toBeNull();
    await page.reload();
    await expect(page.getByTestId('upload-id')).toHaveText(uploadId!);
    await expect(intake).toContainText('Принято уникальных записей: 1');
    await page.getByRole('link', { name: 'К списку батчей', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: 'calls.zip' })).toContainText('calls');
    const kb = path.join(root, 'materials', stream.stream_id, 'knowledge_base');
    await rename(kb, kb + '.disabled');
    expect(
      (
        await request.post(`${target}/v1/admin/batches/${batch.batch_id}/start`, { headers: admin })
      ).ok(),
    ).toBe(true);
    const worker = run(['-m', 'backend.worker']);
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`${target}/v1/batches/${batch.batch_id}`, { headers: owner })
            ).json()
          ).status,
        { timeout: 15000 },
      )
      .toBe('batch_failed');
    await stop(worker);
    await rename(kb + '.disabled', kb);
    await page.goto(`/customer/batches/${batch.batch_id}/state`);
    await expect(
      page.getByRole('heading', { name: 'Восстановление батча', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Загрузить ZIP', { exact: true }).setInputFiles(archivePath);
    await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Восстановление завершено', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('batch-id')).toHaveText(batch.batch_id);
    await expect(page.getByTestId('upload-id')).toHaveText(uploadId!);
    const after = await (
      await request.get(`${target}/v1/batches/${batch.batch_id}`, { headers: owner })
    ).json();
    expect(after.status).toBe('ready');
    expect(after.total_calls).toBe(1);
    expect(after.stream_id).toBe(stream.stream_id);
    expect(
      (
        await request.get(`${target}/v1/batches/${batch.batch_id}/report`, { headers: owner })
      ).status(),
    ).toBe(409);
    expect(
      (await (await request.get(target + '/v1/batches', { headers: owner })).json()).items,
    ).toHaveLength(1);
    expect(browserStarts).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath('live-recovery-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath('live-recovery-mobile.png'),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  } finally {
    for (const child of processes.reverse()) await stop(child);
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('vox-frontend14-')
    )
      throw new Error('Unexpected temporary directory');
    await rm(root, { recursive: true, force: true });
  }
});
