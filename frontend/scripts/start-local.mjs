import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(process.env.VOX_BACKEND_DIR || resolve(frontend, '..', 'backend'));
const helper = resolve(frontend, 'scripts', 'backend-service.py');
const python =
  process.env.VOX_BACKEND_PYTHON ||
  resolve(
    backend,
    '.venv-backend',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
const children = [];
let stopping = false;
let stopped;
let exitCode = 0;
const abort = new AbortController();
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForExit(entries, timeout) {
  let timer;
  try {
    await Promise.race([
      Promise.all(entries.map((entry) => entry.finished)),
      new Promise((done) => {
        timer = setTimeout(done, timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function log(label, message) {
  console.log(`[${label}] ${message}`);
}

async function requireFile(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

function port(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    throw new Error('Порт должен быть числом от 1 до 65535.');
  return Number(value);
}

async function requireFreePort(value) {
  await new Promise((done, fail) => {
    const server = createServer();
    server.once('error', () =>
      fail(
        new Error(
          `Порт ${value} занят или недоступен. Остановите прежний процесс или выберите другой порт.`,
        ),
      ),
    );
    server.listen(value, '127.0.0.1', () => server.close(done));
  });
}

function launch(label, command, args, cwd, env, graceful = false, checking = false) {
  if (stopping) throw new Error('Запуск остановлен.');
  const child = spawn(command, args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const entry = { child, label, graceful, checking, ended: false, code: null };
  children.push(entry);
  if (!checking && child.pid) log(label, `Процесс запущен (PID ${child.pid}).`);
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', (line) => log(label, line));
  }
  child.stdin.on('error', () => {});
  entry.finished = new Promise((done) => {
    child.once('error', () => {
      log(label, 'Не удалось запустить процесс. Проверьте исполняемый файл и окружение.');
      entry.ended = true;
      entry.code = 1;
      done();
      if (!checking) void stop(1);
    });
    child.once('exit', (code) => {
      entry.ended = true;
      entry.code = code;
      done();
      if (!checking && !stopping) {
        log(label, 'Процесс завершился. Останавливаем остальные службы.');
        void stop(1);
      }
    });
  });
  return entry;
}

async function killTree(entry) {
  const pid = entry.child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise((done) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      });
      killer.once('error', done);
      killer.once('exit', done);
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* Already stopped. */
    }
    await waitForExit([entry], 1000);
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* Already stopped. */
    }
  }
}

function stop(code = 0) {
  exitCode = Math.max(exitCode, code);
  if (stopped) return stopped;
  stopping = true;
  abort.abort();
  stopped = (async () => {
    log('Запуск', 'Останавливаем приложение…');
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.unref?.();
    for (const entry of children) {
      if (entry.graceful && !entry.ended) entry.child.stdin.write('stop\n');
    }
    await Promise.all(children.filter((e) => !e.graceful && !e.ended).map(killTree));
    await waitForExit(children, 10_000);
    await Promise.all(children.filter((entry) => !entry.ended).map(killTree));
    await waitForExit(children, 2000);
    if (children.some((entry) => !entry.ended)) {
      exitCode = 1;
      log('Ошибка', 'Не удалось остановить один из процессов. Проверьте сообщения выше.');
    } else log('Запуск', 'Все запущенные этим скриптом процессы остановлены.');
    process.exitCode = exitCode;
  })();
  return stopped;
}

async function waitReady(url, entry, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (!stopping && !entry.ended && Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      /* The server is still starting. */
    }
    await pause(250);
  }
  if (!stopping)
    throw new Error(`${entry.label}: сервер не запустился вовремя. Проверьте сообщения выше.`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: process.env.VOX_FRONTEND_PORT || '4200' },
      'api-port': { type: 'string', default: process.env.VOX_API_PORT || '8000' },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(
      'npm start [-- --port 4200 --api-port 8000] — API, обработчик и фронт.\n' +
        'npm start -- --check — только проверка окружения.\n' +
        'Ctrl+C — остановить приложение.',
    );
    return;
  }
  const frontendPort = port(values.port);
  const apiPort = port(values['api-port']);
  if (frontendPort === apiPort) throw new Error('API и фронту нужны разные порты.');
  const angular = resolve(frontend, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  await requireFile(angular, 'Не установлены зависимости frontend. Выполните npm ci.');
  await requireFile(
    resolve(backend, 'backend', 'api.py'),
    'Не найден соседний backend. Проверьте VOX_BACKEND_DIR.',
  );
  await requireFile(
    python,
    'Не найден Python backend/.venv-backend. Создайте окружение или задайте VOX_BACKEND_PYTHON.',
  );
  await requireFreePort(apiPort);
  await requireFreePort(frontendPort);
  const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' };
  log('Проверка', 'Проверяем окружение backend. Ключи не выводятся.');
  const check = launch('Проверка', python, ['-u', helper, 'check'], backend, env, false, true);
  await check.finished;
  if (stopping) return;
  if (check.code !== 0) throw new Error('Проверка backend не пройдена. Исправьте причину выше.');
  if (values.check) {
    log('Проверка', 'Окружение готово. Службы не запускались.');
    return;
  }
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  log('Запуск', `Запускаем API на ${apiUrl}.`);
  const api = launch('API', python, ['-u', helper, 'api', String(apiPort)], backend, env, true);
  await waitReady(`${apiUrl}/openapi.json`, api, 30_000);
  if (stopping) return;
  launch('Обработчик', python, ['-u', helper, 'worker'], backend, env, true);
  await pause(500);
  if (stopping) return;
  const web = launch(
    'Фронт',
    process.execPath,
    [angular, 'serve', '--host', '127.0.0.1', '--port', String(frontendPort)],
    frontend,
    { ...process.env, VOX_API_TARGET: apiUrl },
  );
  await waitReady(`http://127.0.0.1:${frontendPort}`, web);
  if (!stopping) log('Запуск', `Готово: http://localhost:${frontendPort}. Остановка — Ctrl+C.`);
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
// Raw Ctrl+C avoids broadcasting a second interrupt to Python on Windows.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (data) => {
  if (data.includes(3)) void stop();
});
process.stdin.resume();

try {
  await main();
} catch (error) {
  if (!stopping) log('Ошибка', error.message);
  await stop(stopping ? 0 : 1);
}
if (!children.some((entry) => !entry.ended)) {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdin.unref?.();
}
