# Docker: локальная проверка и сервер /vox/

Репозитории должны находиться рядом:

```text
vox-ai/
  frontend/compose.yaml
  backend/Dockerfile
  backend/.env
```

Compose запускается из `frontend`. Docker Desktop на Windows должен использовать Linux-контейнеры; на сервере нужны Docker Engine и Compose plugin. Для сборки нужен доступ к Docker Hub, npm, Debian и PyPI. Образ содержит SQLite 3.53.4 из официального архива в `backend/vendor` с проверкой SHA3-256; скачивание с sqlite.org на сервере не требуется. Python-пакеты ограничены версиями в `backend/requirements-docker.lock`. Для анализа контейнеру worker нужен доступ к шлюзу Whisper/LLM, включая корпоративный DNS/маршруты.

## Локальная проверка

Существующий `backend/.env` используется для ключей и настроек моделей. Windows-пути к БД и ffprobe автоматически заменяются путями контейнера. Сам `.env` в образы не копируется.

```powershell
cd 'C:\Users\Пользователь\Desktop\vox-ai-workspace\frontend'
docker compose up -d --build
docker compose ps
```

Открыть `http://localhost:18080/vox/`. Войти административным ключом из `backend/.env`.

API и worker имеют общий постоянный Docker-том `vox-ai_vox-data`. Первоначально это новая пустая БД. Локальная `backend/data/vox.sqlite3` в контейнеры автоматически не переносится. `npm start` остаётся отдельным способом разработки с прежней БД и адресом `http://localhost:4200`.

```bash
# Просмотр состояния и последних сообщений
docker compose ps
docker compose logs --tail 100 api worker
# Остановить, сохранив данные
docker compose down
# Запустить вновь
docker compose up -d
# Обновить после изменения кода
docker compose up -d --build
```

Не использовать `down -v`: флаг удаляет постоянный том с БД, материалами и записями. Не масштабировать worker: приложение использует одну последовательную очередь и блокировку.

## Сервер

1. Установить Docker Engine и Compose plugin по инструкции для дистрибутива сервера; включить автозапуск Docker.
2. Разместить соседние репозитории в `/opt/vox-ai/frontend` и `/opt/vox-ai/backend`.
3. Создать `/opt/vox-ai/backend/.env` с серверными ключами и настройками, ограничить чтение файла владельцем (`chmod 600`). На сервере `VOX_ADMIN_API_KEY` должен содержать не менее 24 символов. ffprobe устанавливается внутри образа.
4. Проверить, что `127.0.0.1:18080` свободен. Этот порт нужен только существующему Nginx, открывать его для корпоративной сети не требуется.
5. Из `/opt/vox-ai/frontend` выполнить `docker compose up -d --build`, затем `docker compose ps`.
6. Проверить `curl -I http://127.0.0.1:18080/vox/`.
7. Сохранить копию существующей конфигурации `/etc/nginx/sites-available/digital-cards` (проверить реальный файл по ссылке в sites-enabled). Вставить содержимое `deploy/nginx-host.locations.conf` **внутрь существующего server на 10.3.237.134:8081**. Существующие location карточек не менять.
8. Выполнить `sudo nginx -t`; только при успешной проверке — `sudo systemctl reload nginx`.
9. Открыть `http://10.3.237.134:8081/vox/` из корпоративной сети, проверить вход, создание стрима, загрузку ZIP, ручную постановку батча в очередь, отчёт и обновление внутренней страницы браузером. Проверить, что карточки на `/` продолжают работать.

Контейнер web сохраняет префикс `/vox/`, а `/vox/api/v1/` переводит в `/v1/` контейнера api. Backend и worker не публикуют свои порты на сервере. Лимит полного запроса загрузки в обоих Nginx — 512 МБ; увеличить согласованно в двух конфигурациях при необходимости. Ожидание ответа API — 300 секунд между чтениями; анализ идёт отдельно в worker.

## Резервная копия и перенос

Для согласованной копии остановить приложение и архивировать **весь** том, включая SQLite, материалы и незавершённые записи:

```bash
docker compose stop
docker run --rm --user 0 --mount type=volume,src=vox-ai_vox-data,dst=/data,readonly --mount type=bind,src="$PWD",dst=/backup vox-ai-backend:local tar czf /backup/vox-data-backup.tar.gz -C /data .
docker compose start
```

Команды выше для Linux, из `frontend`. Архив содержит данные заказчиков: хранить отдельно от Git и передавать защищённым способом. `.env` сохранять отдельно. Не удалять том при обычных обновлениях.

Для переноса текущей локальной БД нужна отдельная остановка локального API и worker и копирование всей папки `backend/data` в пустой том с владельцем UID 10001. Не запускать старый и новый обработчик одновременно на одной БД и не смешивать существующие БД. Перенос данных не выполняется автоматически.

## Проверки перед публикацией

- `docker compose config --quiet` — корректность Compose без вывода ключей.
- `docker compose exec web nginx -t` — конфигурация Nginx контейнера.
- `docker compose exec api ffprobe -version` — наличие проверки аудио.
- `docker compose ps` — API и web healthy, worker работает.
- `npx playwright test --config deploy/playwright.config.ts` — браузерная проверка реальной сборки /vox/ (контейнеры должны работать).

Если браузер Playwright не установлен, выполнить `npx playwright install chromium` либо использовать установленный Chrome: в PowerShell `$env:PLAYWRIGHT_CHANNEL='chrome'`, затем команду проверки выше.

- После `docker compose down` и `up -d` заказчики, стримы и батчи сохраняются.
- API/worker запускаются от пользователя `vox` (UID 10001); оба пишут в общий том.

Основа: [Docker Compose env_file](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/), [постоянные тома Docker](https://docs.docker.com/engine/storage/volumes/).
