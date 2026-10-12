import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(process.env.VOX_BACKEND_DIR || resolve(root, '..', 'backend'));
const python =
  process.env.VOX_BACKEND_PYTHON ||
  resolve(
    backend,
    '.venv-backend',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
const script = resolve(root, 'scripts/start-local.mjs');
const runtime = resolve(root, '.scratch/runtime');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function temp() {
  await mkdir(runtime, { recursive: true });
  return mkdtemp(resolve(runtime, 'launcher-'));
}
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
function processRun(command, args, env, cwd = root) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data.toString();
  });
  child.stderr.on('data', (data) => {
    output += data.toString();
  });
  const finished = new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', done);
  });
  return { child, finished, output: () => output };
}
async function waitFor(run, text, timeout = 120_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (run.output().includes(text)) return;
    if (run.child.exitCode !== null) assert.fail(run.output());
    await delay(100);
  }
  assert.fail(`Не дождались ${text}: ${run.output()}`);
}
async function setup() {
  const directory = await temp();
  const api = await freePort(),
    web = await freePort();
  const env = {
    ...process.env,
    VOX_BACKEND_DIR: backend,
    VOX_BACKEND_PYTHON: python,
    VOX_DATABASE_PATH: resolve(directory, 'vox.sqlite3'),
    VOX_MATERIALS_ROOT: resolve(directory, 'streams'),
    VOX_INPUTS_ROOT: resolve(directory, 'inputs'),
    VOX_WORKER_LOCK: resolve(directory, 'worker.lock'),
    VOX_ADMIN_API_KEY: 'local-launcher-test-admin-key',
    WHISPER_API_KEY: 'local-test-provider-key',
    GPL_API_KEY: 'local-test-provider-key',
    WHISPER_BASE_URL: 'http://127.0.0.1:1/v1',
    GPL_BASE_URL: 'http://127.0.0.1:1/v1',
    WHISPER_MODEL: 'test',
    GPL_MODEL: 'test',
  };
  return { env, api, web, directory, args: ['--api-port', String(api), '--port', String(web)] };
}
async function launch(config, extra = [], viaNpm = false) {
  return processRun(process.execPath,
    viaNpm ? [process.env.npm_execpath, 'start', '--', ...config.args, ...extra]
      : [script, ...config.args, ...extra], config.env);
}
async function stop(run) {
  if (run.child.exitCode === null) run.child.stdin.write(Buffer.from([3]));
  let timer;
  try {
    return await Promise.race([
      run.finished,
      new Promise((_, fail) => {
        timer = setTimeout(
          () => fail(new Error('Процессы не остановились: ' + run.output())),
          20_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function assertPortsReleased(config) {
  for (const port of [config.api, config.web]) {
    const server = createServer();
    await new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', () => server.close(done));
    });
  }
}

test(
  'npm start обслуживает API через фронт; Ctrl+C освобождает порты и блокировки',
  { timeout: 150_000 },
  async () => {
    const config = await setup();
    const run = await launch(config, [], true);
    try {
      await waitFor(run, '[Запуск] Готово:');
      const response = await fetch(`http://127.0.0.1:${config.web}/api/v1/access-context`, {
        headers: { Authorization: `Bearer ${config.env.VOX_ADMIN_API_KEY}` },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { role: 'admin', customer: null });
      assert.match(run.output(), /\[Обработчик\].*ожидает батчи/);
      assert.ok(!run.output().includes(config.env.VOX_ADMIN_API_KEY));
      assert.equal(await stop(run), 0);
      await assertPortsReleased(config);
      const check = await launch(config, ['--check']);
      assert.equal(await check.finished, 0, check.output());
    } finally {
      await stop(run);
    }
  },
);

test(
  'падение обработчика останавливает API и фронт с ненулевым кодом',
  { timeout: 150_000 },
  async () => {
    const config = await setup();
    const run = await launch(config);
    try {
      await waitFor(run, '[Запуск] Готово:');
      const pid = Number(/\[Обработчик\] Процесс запущен \(PID (\d+)\)/.exec(run.output())[1]);
      if (process.platform === 'win32') {
        const kill = processRun('taskkill', ['/PID', String(pid), '/T', '/F'], process.env);
        assert.equal(await kill.finished, 0);
      } else process.kill(pid, 'SIGTERM');
      await waitFor(run, 'Все запущенные этим скриптом процессы остановлены.');
      assert.equal(await run.finished, 1);
      await assertPortsReleased(config);
    } finally {
      await stop(run);
    }
  },
);

test('остановка во время запуска не оставляет сервер', { timeout: 40_000 }, async () => {
  const config = await setup();
  const run = await launch(config);
  try {
    await waitFor(run, '[API] Процесс запущен');
    assert.equal(await stop(run), 0);
    await assertPortsReleased(config);
  } finally {
    await stop(run);
  }
});

test('занятый порт не запускает службы и не закрывает чужой сервер', async () => {
  const config = await setup();
  const server = createServer();
  await new Promise((done) => server.listen(config.web, '127.0.0.1', done));
  try {
    const run = await launch(config);
    assert.equal(await run.finished, 1);
    assert.match(run.output(), new RegExp(`Порт ${config.web} занят`));
    assert.ok(!run.output().includes('[API]'));
    assert.equal(server.listening, true);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('ошибка ключа объясняется без значения секрета', async () => {
  const config = await setup();
  config.env.VOX_ADMIN_API_KEY = 'xyz';
  const run = await launch(config, ['--check']);
  assert.equal(await run.finished, 1);
  assert.match(run.output(), /VOX_ADMIN_API_KEY \(не менее 24 символов\)/);
  assert.ok(!run.output().includes('xyz'));
});

test('отсутствующий .env и Python дают понятную ошибку до запуска служб', async () => {
  const config = await setup();
  const emptyBackend = await temp();
  await mkdir(resolve(emptyBackend, 'backend'));
  await writeFile(resolve(emptyBackend, 'backend/api.py'), '');
  config.env.VOX_BACKEND_DIR = emptyBackend;
  const noEnv = await launch(config, ['--check']);
  assert.equal(await noEnv.finished, 1);
  assert.match(noEnv.output(), /Нет backend\/.env/);
  config.env.VOX_BACKEND_PYTHON = resolve(emptyBackend, 'missing-python');
  const noPython = await launch(config, ['--check']);
  assert.equal(await noPython.finished, 1);
  assert.match(noPython.output(), /Не найден Python/);
});

test('работающий обработчик не допускает второй запуск с той же БД', async () => {
  const config = await setup();
  const holder = processRun(
    python,
    [
      '-u',
      '-c',
      "from filelock import FileLock; import sys; lock=FileLock(sys.argv[1]); lock.acquire(); print('locked', flush=True); sys.stdin.readline(); lock.release()",
      config.env.VOX_WORKER_LOCK,
    ],
    config.env,
    backend,
  );
  try {
    await waitFor(holder, 'locked', 10_000);
    const run = await launch(config, ['--check']);
    assert.equal(await run.finished, 1);
    assert.match(run.output(), /Обработчик уже запущен/);
  } finally {
    holder.child.stdin.end('\n');
    await holder.finished;
  }
});
