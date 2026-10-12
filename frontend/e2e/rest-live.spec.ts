import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { CRITERIA } from '../src/app/reports/report-models';

test.use({ trace: 'off' }); // Ephemeral API keys must not enter retained traces.
test('живой backend: вход, чтение, изоляция и роль команды через браузерный прокси', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    process.env['VOX_LIVE_BACKEND'] !== '1',
    'Opt-in acceptance with an isolated local backend',
  );
  const backend = path.resolve('../backend');
  const target = process.env['VOX_API_TARGET'] ?? 'http://127.0.0.1:8765';
  const url = new URL(target);
  expect(url.hostname).toBe('127.0.0.1');
  const root = await mkdtemp(path.join(tmpdir(), 'vox-frontend12-'));
  const adminKey = randomUUID();
  const server = spawn(
    process.env['VOX_BACKEND_PYTHON'] ?? path.join(backend, '.venv-backend/Scripts/python.exe'),
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
        VOX_ADMIN_API_KEY: adminKey,
        VOX_DATABASE_PATH: path.join(root, 'api.sqlite3'),
        VOX_MATERIALS_ROOT: path.join(root, 'materials'),
        VOX_INPUTS_ROOT: path.join(root, 'inputs'),
      },
    },
  );
  try {
    await expect
      .poll(
        async () => {
          if (server.exitCode !== null) return false;
          try {
            return (await request.get(`${target}/openapi.json`)).ok();
          } catch {
            return false;
          }
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const admin = { Authorization: `Bearer ${adminKey}` };
    const response = await request.post(`${target}/v1/admin/customers`, {
      headers: admin,
      data: { name: 'Живой заказчик А' },
    });
    expect(response.status()).toBe(201);
    const customer = await response.json();
    const second = await request.post(`${target}/v1/admin/customers`, {
      headers: admin,
      data: { name: 'Живой заказчик Б' },
    });
    const other = await second.json();
    const config = {
      name: 'Живой стрим',
      whisper_model: 'whisper-large-v3',
      llm_model: 'kimi-k2.7-code',
      speech_lang: 'ru',
      role_prompt: 'Определи роли: {fragments}',
      analysis_system_prompt: 'Оцени разговор',
      analysis_user_prompt: '{checklist}\n{kb}\n{metrics}\n{dialog}',
    };
    const created = await request.post(
      `${target}/v1/admin/customers/${customer.customer_id}/streams`,
      {
        headers: admin,
        multipart: {
          config: JSON.stringify(config),
          knowledge_base: {
            name: 'knowledge.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Правила работы контакт-центра', 'utf8'),
          },
        },
      },
    );
    expect(created.status()).toBe(201);
    const stream = await created.json();
    const ownerHeaders = { Authorization: `Bearer ${customer.api_key}` };
    const upload = randomUUID();
    const batch = await request.post(`${target}/v1/batches`, {
      headers: ownerHeaders,
      data: { stream_id: stream.stream_id, upload_id: upload },
    });
    expect(batch.status()).toBe(201);
    expect(
      (
        await request.get(`${target}/v1/access-context`, {
          headers: { Authorization: 'Bearer invalid-key' },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.get(`${target}/v1/streams`, {
          headers: ownerHeaders,
          params: { customer_id: other.customer_id },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await request.get(`${target}/v1/admin/customers`, { headers: ownerHeaders })).status(),
    ).toBe(403);

    await page.goto('/connect');
    await page.getByLabel('API-ключ', { exact: true }).fill(customer.api_key);
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    await expect(page.getByRole('banner')).toContainText('Живой заказчик А');
    await expect(page.getByRole('table')).toContainText(upload);
    await expect(page.getByRole('table')).toContainText('Загружается');
    await expect(page.getByRole('table')).not.toContainText('11 из 11');
    await page.reload();
    await expect(page.getByRole('table')).toContainText(upload);
    await page.screenshot({ path: testInfo.outputPath('rest-batches.png'), fullPage: true });
    await page.getByRole('link', { name: 'Стримы', exact: true }).click();
    await expect(page.locator('article')).toContainText('Живой стрим');
    await page.getByText('Критерии оценки · 11', { exact: true }).click();
    await expect(page.getByRole('listitem')).toHaveCount(11);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page).toHaveURL(/\/connect$/);
    await page.getByLabel('API-ключ', { exact: true }).fill(other.api_key);
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    await expect(page.getByRole('banner')).toContainText('Живой заказчик Б');
    await expect(page.getByRole('status')).toContainText('Пока нет готовых стримов');
    await expect(page.locator('body')).not.toContainText(upload);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page).toHaveURL(/\/connect$/);
    await page.getByLabel('API-ключ', { exact: true }).fill(adminKey);
    // Wait for the newly routed form, rather than filling a departing form.
    expect((await page.getByLabel('API-ключ', { exact: true }).inputValue()) === adminKey).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    await expect(page).toHaveURL(/\/team\/batches$/);
    await expect(page.getByLabel('Заказчик', { exact: true }).getByRole('option')).toHaveCount(2);
    await page.goto(`/team/streams/new?organization=${customer.customer_id}`);
    await page.getByLabel('Название стрима', { exact: true }).fill('Все критерии');
    await page.getByLabel('Поиск нежелательных выражений', { exact: true }).uncheck();
    await page.getByLabel('Корректировка текста транскрипции', { exact: true }).uncheck();
    await page
      .getByLabel('База знаний', { exact: true })
      .setInputFiles({ name: 'kb.txt', mimeType: 'text/plain', buffer: Buffer.from('Правила') });
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().endsWith(`/admin/customers/${customer.customer_id}/streams`),
    );
    await page.getByRole('button', { name: 'Создать стрим', exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(201);
    const selectedStream = await savedResponse.json();
    expect(selectedStream.config.enabled_criteria).toEqual(CRITERIA.map((c) => c.id));
    expect(selectedStream.config.zero_total_on_critical).toBe(true);
    await expect(page.getByRole('listitem')).toHaveCount(11);
    await page.reload();
    await expect(page.getByRole('listitem')).toHaveCount(11);
    await page.getByRole('link', { name: 'Создать на основе стрима', exact: true }).click();
    await expect(page.locator('.stream-criteria input')).toHaveCount(0);
    await page.getByText('11 фиксированных критериев оценки', { exact: true }).click();
    await expect(page.locator('.stream-criteria li')).toHaveCount(11);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  } finally {
    if (server.exitCode === null) {
      const ended = once(server, 'exit');
      server.kill();
      await ended;
    }
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('vox-frontend12-')
    ) {
      throw new Error('Unexpected temporary directory');
    }
    await rm(root, { recursive: true, force: true });
  }
});
