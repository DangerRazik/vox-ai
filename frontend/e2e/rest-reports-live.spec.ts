import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

test.use({ trace: 'off' });
test('живые опубликованные отчёты: батч → звонок, перезагрузка и сравнение', async ({
  page,
  request,
}, testInfo) => {
  const fixturePath = process.env['VOX_REPORTS_FIXTURE'];
  test.skip(!fixturePath, 'Opt-in: separately prepared real published batches');
  const fixture = JSON.parse(await readFile(fixturePath!, 'utf8')) as {
    root: string;
    database: string;
    admin_key: string;
    customer: { name: string; api_key: string };
    stream_id: string;
    batch_ids: string[];
    call_ids: string[];
  };
  const backend = path.resolve('../backend');
  const target = process.env['VOX_API_TARGET'] ?? 'http://127.0.0.1:8765';
  const url = new URL(target);
  expect(url.hostname).toBe('127.0.0.1');
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
        VOX_ADMIN_API_KEY: fixture.admin_key,
        VOX_DATABASE_PATH: fixture.database,
        VOX_MATERIALS_ROOT: path.join(fixture.root, 'materials'),
        VOX_INPUTS_ROOT: path.join(fixture.root, 'inputs'),
        WHISPER_BASE_URL: 'http://127.0.0.1:1/v1',
        GPL_BASE_URL: 'http://127.0.0.1:1/v1',
        WHISPER_API_KEY: 'unavailable-for-tests',
        GPL_API_KEY: 'unavailable-for-tests',
      },
    },
  );
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await request.get(`${target}/openapi.json`)).ok();
          } catch {
            return false;
          }
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const headers = { Authorization: `Bearer ${fixture.customer.api_key}` };
    const summaries = await Promise.all(
      fixture.batch_ids.map(async (id) => {
        const response = await request.get(`${target}/v1/batches/${id}/report`, { headers });
        expect(response.ok()).toBe(true);
        return response.json();
      }),
    );
    const response = await request.get(`${target}/v1/calls/${fixture.call_ids[0]}/report`, {
      headers,
    });
    expect(response.ok()).toBe(true);
    const call = await response.json();
    expect(call.status).toBe('successful');
    const number = (value: number) =>
      new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
    await page.goto('/connect');
    await page.getByLabel('API-ключ', { exact: true }).fill(fixture.customer.api_key);
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    await expect(page).toHaveURL(/\/customer\/batches$/);
    await page.getByRole('link', { name: /Отчёт/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Сводный отчёт', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Средняя оценка', exact: true })).toContainText(
      `${number(summaries[0].average_total)} из 11`,
    );
    await page.getByRole('link', { name: call.original_name, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Разбор звонка', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Итоговая оценка', exact: true })).toContainText(
      `${number(call.result.total)} из 11`,
    );
    await expect(page.locator('details.criterion-detail')).toHaveCount(11);
    await expect(page.locator('.segment-text').first()).toHaveText(call.result._segments[0].text);
    await page.reload();
    await expect(page.locator('.segment-text').first()).toHaveText(call.result._segments[0].text);
    await page.screenshot({ path: testInfo.outputPath('live-call-report.png'), fullPage: true });
    await page.getByRole('link', { name: 'Сравнение', exact: true }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(2);
    await page.getByRole('checkbox').nth(1).check();
    await page.getByRole('checkbox').nth(0).check();
    await page.getByRole('button', { name: 'Сравнить выбранные батчи', exact: true }).click();
    const table = page.getByRole('region', { name: 'Таблица сравнения', exact: true });
    await expect(table).toBeVisible();
    await expect(
      table.getByRole('row', { name: /Средняя оценка, из 11/ }).getByRole('cell'),
    ).toHaveText([number(summaries[1].average_total), number(summaries[0].average_total)]);
    await expect(table.getByRole('link').first()).toHaveAttribute(
      'href',
      `/customer/batches/${fixture.batch_ids[1]}/report`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath('live-comparison-mobile.png'),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  } finally {
    if (server.exitCode === null) {
      const ended = once(server, 'exit');
      server.kill();
      await ended;
    }
  }
});
