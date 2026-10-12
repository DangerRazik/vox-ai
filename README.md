# Vox AI

Система анализа качества звонков: Angular frontend, FastAPI backend, SQLite и последовательный обработчик Whisper/LLM.

```text
frontend/   интерфейс, Docker Compose и настройки Nginx
backend/    API, обработчик, анализ звонков и Dockerfile
```

## Запуск в Docker

На компьютере или сервере нужен Docker с Linux-контейнерами и Docker Compose.

Создайте `backend/.env` по инструкции в [README backend](backend/README.md). Ключи и файлы `.env` в Git не добавляются. ffprobe и совместимая SQLite устанавливаются внутри образа.

Из папки `frontend`:

```bash
docker compose up -d --build
docker compose ps
```

Откройте `http://localhost:18080/vox/` и войдите административным ключом из `.env`.
В Ubuntu при отсутствии доступа пользователя к Docker используйте `sudo docker compose`.

Данные сохраняются в Docker-томе `vox-ai_vox-data`. Новый запуск на другом компьютере создаёт отдельную пустую БД: записи, заказчики и результаты не переносятся через Git.

Остановка с сохранением данных:

```bash
docker compose down
```

Флаг `-v` удаляет том с данными; для обычного обновления его не используйте.

## Разработка

Подготовьте виртуальное окружение Python и `.env` согласно [backend/README.md](backend/README.md). Затем из `frontend`:

```bash
npm ci
npm start
```

Локальный адрес — `http://localhost:4200`. Локальная БД в `backend/data` отделена от Docker-тома.

## Документация

- [Frontend](frontend/README.md)
- [Backend](backend/README.md)
- [Docker, корпоративный сервер и Nginx /vox/](frontend/docs/docker-deployment.md)
- [Загрузка ZIP через API](backend/docs/archive-api.md)

Проект объединён из двух локальных репозиториев текущим снимком файлов. Предыдущая история frontend и backend остаётся в исходных репозиториях GitLab.
