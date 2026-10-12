"""Local launcher adapter: validate settings and stop Python services on Windows."""
import importlib
import os
from pathlib import Path
import sys

# Services run from the backend checkout, not from this script's frontend folder.
sys.path.insert(0, str(Path.cwd()))


def check():
    if not Path('.env').is_file():
        print('Нет backend/.env. Создайте файл с настройками и ключами.', flush=True)
        return 1
    if sys.version_info < (3, 10):
        print('Нужен Python 3.10 или новее.', flush=True)
        return 1
    for name in ('fastapi', 'uvicorn', 'multipart', 'pydantic_settings', 'httpx',
                 'openai', 'bs4', 'dotenv', 'filelock'):
        try:
            importlib.import_module(name)
        except ImportError:
            print('Не установлены зависимости backend. Выполните в backend: '
                  'python -m pip install -r requirements.txt', flush=True)
            return 1
    from pydantic import ValidationError
    try:
        from backend.config import BackendSettings
        backend = BackendSettings()
        from config import settings
    except ValidationError as error:
        # Never format ValidationError: its default representation exposes input keys.
        names = []
        for item in error.errors(include_input=False, include_context=False, include_url=False):
            name = str(item['loc'][0])
            names.append('VOX_ADMIN_API_KEY (не менее 24 символов)' if name == 'admin_api_key' else name)
        print('Проверьте настройки backend/.env: ' + ', '.join(names), flush=True)
        return 1
    if not all(getattr(settings, name).strip() for name in
               ('WHISPER_API_KEY', 'WHISPER_BASE_URL', 'WHISPER_MODEL', 'GPL_BASE_URL', 'GPL_MODEL')):
        print('Заполните настройки Whisper и LLM в backend/.env.', flush=True)
        return 1
    import subprocess
    try:
        subprocess.run([backend.ffprobe_path, '-version'], check=True, timeout=10,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        print('Не найден рабочий ffprobe. Проверьте VOX_FFPROBE_PATH в backend/.env.', flush=True)
        return 1
    from contextlib import ExitStack
    from filelock import FileLock, Timeout
    try:
        # Readiness checks do not initialize or change the database or queued batches.
        with ExitStack() as locks:
            for path in (backend.database_path, backend.materials_root, backend.inputs_root,
                         backend.worker_lock):
                parent = path.resolve().parent
                parent.mkdir(parents=True, exist_ok=True)
                if not os.access(parent, os.W_OK):
                    print('Нет доступа для записи к директории данных backend.', flush=True)
                    return 1
            for path in (backend.worker_lock.resolve(),
                         Path(str(backend.database_path.resolve()) + '.worker.lock')):
                locks.enter_context(FileLock(str(path), timeout=0))
    except Timeout:
        print('Обработчик уже запущен для этой БД. Остановите прежний обработчик.', flush=True)
        return 1
    except OSError:
        print('Не удалось открыть директории данных backend. Проверьте пути и права.', flush=True)
        return 1
    print('Python, зависимости, .env, ffprobe и блокировки обработчика проверены.', flush=True)
    return 0


def run_service(kind, port=None):
    import _thread
    import threading

    def control():
        # SIGINT from Node does not gracefully interrupt Python on Windows.
        # A stdin command requests the same Python interrupt as Ctrl+C.
        for line in sys.stdin:
            if line.strip() == 'stop':
                _thread.interrupt_main()
                return

    threading.Thread(target=control, daemon=True).start()
    try:
        if kind == 'api':
            import uvicorn
            uvicorn.run('backend.api:create_app', factory=True, host='127.0.0.1', port=int(port))
        else:
            from backend.worker import main
            print('Обработчик запущен, ожидает батчи в очереди.', flush=True)
            main()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    try:
        mode = sys.argv[1]
        result = check() if mode == 'check' else run_service(mode, sys.argv[2] if mode == 'api' else None)
    except Exception as error:
        # Do not print exception input values, configuration or provider credentials.
        print('Не удалось запустить backend (' + type(error).__name__ + '). Проверьте окружение.', flush=True)
        result = 1
    raise SystemExit(result)
