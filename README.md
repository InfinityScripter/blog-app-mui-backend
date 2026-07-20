# blog-app-mui-backend

<p align="center">
  <img src="docs/news-bot-pipeline.gif" alt="Конвейер новостного бота: RSS → карточка в Telegram → рерайт LLM → аппрув → публикация" width="720">
</p>

API-бэкенд блога **[aifirst.us.com](https://aifirst.us.com)** и сопутствующих сервисов.
Next.js 14 (pages router, используется только как API-сервер), PostgreSQL, JWT-авторизация.https://github.com/InfinityScripter/blog-app-mui-backend/blob/main/README.md
Порт — **7272**, прод — `https://api.aifirst.us.com:8444`.

Что живёт в этом бэкенде:

- **Блог** — посты, комментарии, поиск, счётчик просмотров (фронт: `blog-app-mui-frontend` → Vercel).
- **Auth** — регистрация с подтверждением email, вход, сброс пароля, OAuth Google и Яндекс, роли `user`/`admin`.
- **Changelog AI-моделей** — публичная лента релизов моделей (`/api/changelog/*`), наполняется ботом.
- **Newsletter** — рассылка с double-opt-in подтверждением.
- **Файлы** — загрузка и раздача файлов прямо из PostgreSQL (см. [README-FILE-STORAGE.md](README-FILE-STORAGE.md)).
- **Админка** — пользователи, посты, audit-логи, метрики сервера, управление новостным ботом (`ai-bot-tg`).
- **Dogs-teacher** — запись на занятия к кинологу (отдельный сайт teacher.dog): слоты, заявки, Telegram-бот, web push, напоминания. Живёт в отдельной БД `dogs_teacher`.
- **Chat / Kanban / Calendar** — PG-бэкенд одноимённых разделов дашборда (фронт сейчас их не вызывает, но API рабочий и покрыт тестами).
- **Mail / Product** — мок-данные для демонстрационных разделов фронта (не БД).

## Как устроен код

Слоистая архитектура (подробно — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

```
HTTP-запрос
   │
   ▼
src/middleware.ts            ← edge-middleware: CORS для всех /api/* (единственное место)
   │
   ▼
src/pages/api/<домен>/…      ← роут: тонкий. Метод-гард → middleware-обёртки → вызов сервиса → ответ
   │        (обёртки из src/middlewares/: requireAuth, requireAdmin, requireDogsAdmin,
   │         validateBody/validateQuery (zod), withRateLimit, withMethods)
   ▼
src/services/<домен>.ts      ← бизнес-логика. Без req/res: принимает данные,
   │                            возвращает данные или бросает AppError(status, message)
   ▼
src/models/ + src/lib/db.ts  ← доступ к данным: активные записи User/Post/File
                                поверх pg Pool; dogs — отдельный пул lib/dogs-db.ts
```

### Карта папок

| Папка                   | Что лежит                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/pages/api/`        | HTTP-роуты по доменам. Только парсинг → валидация → сервис → ответ                                                                                                                                                                                     |
| `src/middlewares/`      | Обёртки хендлеров: `require-auth` (JWT + сервис-токен бота), `require-admin`, `require-dogs-admin`, `validate` (zod body/query), `rate-limit`, `with-methods`                                                                                          |
| `src/middleware.ts`     | Edge-middleware Next.js — CORS (это спец-файл Next, не переносить в `middlewares/`)                                                                                                                                                                    |
| `src/services/`         | Бизнес-логика доменов. Бросают `AppError`, роут маппит через `sendError()`                                                                                                                                                                             |
| `src/models/`           | `User`, `Post`, `File` — активные записи поверх PostgreSQL (Mongoose-подобный API: `findById`, `findOne`, `create`, `save`)                                                                                                                            |
| `src/schemas/`          | Zod-схемы запросов + выведенные из них типы тел                                                                                                                                                                                                        |
| `src/types/`            | Общие TS-контракты: `api.ts` (`ApiSuccess`/`ApiError`/`AppError`), `audit.ts`, `bot-control.ts`, `system-metrics.ts`, `subscriber.ts`, `model-release.ts`, `kanban.ts`, `dogs.ts`                                                                      |
| `src/constants/`        | Общие константы: `http.ts` (статусы + методы), `messages.ts` (тексты ответов), `auth.ts` (SALT_ROUNDS, лимит неудачных входов), `pagination.ts` (лимиты списков), `dogs.ts` (телефон/карта бизнеса)                                                    |
| `src/lib/`              | Инфраструктура: `db.ts` (pg Pool + автосхема), `dogs-db.ts`, `jwt.ts`, `passport.ts` (Google OAuth)                                                                                                                                                    |
| `src/utils/`            | Чистые хелперы: `response.ts` (`ok`/`sendError`), `email.ts`, `normalize-email.ts`, `audit-context.ts` (`emitAudit`), `allowed-origin.ts`, `client-ip.ts`, `public-user.ts`, `post-payload.ts`, `slug.ts`, `uuidv4.ts`, `change-case.ts`, dogs-хелперы |
| `src/_mock/`            | Статические данные для демо-роутов mail/product                                                                                                                                                                                                        |
| `src/tests/`            | Jest + Supertest; БД — `pg-mem` (in-memory Postgres), структура зеркалит `src/`                                                                                                                                                                        |
| `scripts/`              | Отдельные ops-скрипты (сид changelog, аудит новостей) — см. [scripts/README.md](scripts/README.md)                                                                                                                                                     |
| `deploy/`, `Dockerfile` | Docker-вариант запуска (VDS сейчас работает без Docker, через systemd)                                                                                                                                                                                 |

### Конвенции

- **Ответы:** успех — `{ message?, success: true, data?/post?/… }`, ошибка — `{ success?: false, message }` с корректным HTTP-статусом. Сервисы бросают `AppError(status, message)`; роут отдаёт его через `sendError(res, error)`.
- **Без магии в коде:** статусы только из `HTTP.*`, повторяющиеся тексты — из `MSG.*`, методы — `HTTP_METHOD.*`. Общие константы — в `src/constants/`; константа, нужная одному модулю, живёт в нём (с комментарием), это осознанно.
- **Типы:** контракты доменов (DTO, payload'ы) — в `src/types/`; внутренние `*Row`/`*Params` — приватно в сервисе.
- **Импорты:** только алиас `@/src/...` (без `../../..`).
- **CORS:** единственный источник — `src/middleware.ts` + allow-list в `src/utils/allowed-origin.ts`. Пер-роутного CORS нет.
- **Audit:** значимые действия пишутся в `audit_logs` через `emitAudit(req, {...})` — fire-and-forget, не может завалить бизнес-операцию.

## Ручки API

Авторизация: **JWT** — заголовок `Authorization: Bearer <token>`; **admin** — JWT + `role === 'admin'`; **dogs-admin** — отдельный токен из `/api/dogs/admin/login`; **public** — без авторизации.

### Auth `/api/auth`

| Метод | Путь                           | Доступ         | Что делает                                                      |
| ----- | ------------------------------ | -------------- | --------------------------------------------------------------- |
| POST  | `/sign-up`                     | public, ≤3/мин | Регистрация, шлёт код подтверждения на email                    |
| POST  | `/sign-in`                     | public, ≤5/мин | Вход → JWT. После 5 неудач аккаунт блокируется до сброса пароля |
| GET   | `/me`                          | JWT            | Текущий пользователь                                            |
| POST  | `/verify`                      | public         | Подтверждение email кодом                                       |
| POST  | `/resend-verification`         | public         | Повторная отправка кода                                         |
| POST  | `/reset-password`              | public         | Отправка кода сброса пароля на email                            |
| POST  | `/update-password`             | public         | Смена пароля по коду сброса                                     |
| GET   | `/google` → `/google/callback` | public         | OAuth Google (passport), редирект на фронт с токеном            |
| GET   | `/yandex` → `/yandex/callback` | public         | OAuth Яндекс (ручной flow), редирект на фронт с токеном         |

### Посты `/api/post`

| Метод           | Путь                    | Доступ                     | Что делает                                                                                                      |
| --------------- | ----------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET             | `/list`                 | public (JWT опц.), ≤60/мин | Список постов. Без токена — только published; юзер видит свои, admin — все. Пагинация `?page&limit` опциональна |
| GET             | `/details?title={slug}` | public                     | Пост по слагу заголовка                                                                                         |
| GET             | `/latest?title={slug}`  | public                     | Свежие посты, кроме текущего                                                                                    |
| GET             | `/search?query={q}`     | public (JWT опц.), ≤30/мин | Поиск                                                                                                           |
| POST            | `/new`                  | JWT                        | Создать пост (этим же путём публикует новостной бот)                                                            |
| PATCH/PUT       | `/{id}/edit`            | JWT, владелец              | Обновить пост                                                                                                   |
| DELETE          | `/{id}/delete`          | JWT, владелец              | Удалить пост                                                                                                    |
| POST/PATCH      | `/{id}/publish`         | JWT                        | Сменить статус publish/draft                                                                                    |
| POST            | `/{id}/view`            | public, ≤30/мин            | +1 к просмотрам                                                                                                 |
| POST/PUT/DELETE | `/{id}/comments`        | JWT                        | Добавить / изменить / удалить комментарий (и ответы)                                                            |

### Changelog AI-моделей `/api/changelog`

| Метод | Путь      | Доступ                              | Что делает                                   |
| ----- | --------- | ----------------------------------- | -------------------------------------------- |
| GET   | `/list`   | public, ≤60/мин                     | Лента релизов (пагинация, фильтр по вендору) |
| GET   | `/{slug}` | public                              | Один релиз                                   |
| POST  | `/new`    | admin (обычно бот по сервис-токену) | Создать релиз                                |

### Newsletter `/api/newsletter`

| Метод | Путь                  | Доступ          | Что делает                                          |
| ----- | --------------------- | --------------- | --------------------------------------------------- |
| POST  | `/subscribe`          | public, ≤5/мин  | Подписка (double-opt-in: шлёт письмо-подтверждение) |
| GET   | `/confirm?token=`     | public, ≤20/мин | Подтверждение подписки                              |
| GET   | `/unsubscribe?token=` | public, ≤20/мин | Отписка                                             |
| POST  | `/send`               | admin           | Разослать дайджест подтверждённым подписчикам       |

### Файлы

| Метод  | Путь                       | Доступ        | Что делает                              |
| ------ | -------------------------- | ------------- | --------------------------------------- |
| POST   | `/api/upload`              | JWT           | Загрузка файла (multipart) в PostgreSQL |
| GET    | `/api/file/{id}`           | public        | Отдать файл (бинарно, с mime-типом)     |
| DELETE | `/api/file/delete?fileId=` | JWT, владелец | Удалить файл                            |

Подробности хранения — [README-FILE-STORAGE.md](README-FILE-STORAGE.md).

### Профиль `/api/user`

| Метод       | Путь               | Доступ | Что делает                                                |
| ----------- | ------------------ | ------ | --------------------------------------------------------- |
| PATCH       | `/profile`         | JWT    | Сменить имя                                               |
| POST/DELETE | `/avatar`          | JWT    | Установить / убрать аватар                                |
| POST        | `/change-password` | JWT    | Смена пароля (по текущему паролю; не путать с reset-flow) |

### Админка `/api/admin` (всё — JWT + role=admin)

| Метод      | Путь                                                                    | Что делает                                               |
| ---------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| GET        | `/users` · DELETE `/users/{id}`                                         | Список / удаление пользователей                          |
| PUT/DELETE | `/posts/{id}`                                                           | Правка / удаление любого поста                           |
| GET        | `/audit-logs`                                                           | Audit trail с фильтрами и пагинацией                     |
| POST       | `/audit/ingest`                                                         | Приём audit-событий от бота (whitelist действий)         |
| GET        | `/system-metrics`                                                       | Живые метрики VDS: CPU, память, диск, БД                 |
| GET/POST   | `/llm-stats/snapshot`                                                   | Снапшот статистики использования LLM                     |
| GET        | `/bot/status` · `/bot/providers` · `/bot/models` · `/bot/models-health` | Состояние новостного бота (прокси на его control-сервер) |
| POST       | `/bot/model` · `/bot/mock`                                              | Переключить модель / мок-режим бота                      |

### Dogs-teacher `/api/dogs` (сайт записи к кинологу)

| Метод    | Путь                                                                          | Доступ          | Что делает                                                                |
| -------- | ----------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------- |
| GET      | `/booking/slots`                                                              | public          | Свободные слоты                                                           |
| POST     | `/booking/requests`                                                           | public          | Создать заявку (уведомления владельцу в Telegram)                         |
| GET      | `/booking/client/{token}`                                                     | по токену       | Личный кабинет клиента                                                    |
| PATCH    | `/booking/client/{token}/cancel`                                              | по токену       | Клиент отменяет заявку                                                    |
| POST     | `/admin/login`                                                                | по паролю       | Вход админа → dogs-токен                                                  |
| GET/POST | `/admin/slots` · PATCH/DELETE `/admin/slots/{id}` · POST `/admin/slots/batch` | dogs-admin      | Управление слотами                                                        |
| GET      | `/admin/bookings` · PATCH/DELETE `/admin/bookings/{id}`                       | dogs-admin      | Заявки: подтвердить/отклонить/удалить (клиенту летит email+TG+push)       |
| POST     | `/push/subscribe` · `/push/unsubscribe` · GET `/push/vapid-public-key`        | public          | Web-push подписки                                                         |
| POST     | `/telegram/webhook`                                                           | секрет в Bearer | Вебхук Telegram-бота (привязка клиента, меню, контакты)                   |
| GET/POST | `/internal/reminders`                                                         | опц. секрет     | Триггер напоминаний о занятиях (дергает cron; в процессе тоже тикает сам) |

### Chat / Kanban / Calendar (JWT; фронт пока не подключён)

- `GET/POST /api/chat/channels`, `GET/POST /api/chat/{channelId}/messages`, `GET /api/chat/{channelId}/stream` (SSE, токен в query)
- `GET/POST /api/kanban/boards`, `GET/DELETE /api/kanban/boards/{boardId}`, `POST .../columns`, `DELETE /api/kanban/columns/{columnId}`, `POST .../tasks`, `PATCH/DELETE /api/kanban/tasks/{taskId}`
- `GET/POST /api/calendar/events`, `PATCH/DELETE /api/calendar/events/{id}`

### Демо-данные (Minimal-шаблон, без БД)

- `GET /api/mail/list|details|labels`, `GET /api/product/list|details|search` — статика из `src/_mock/`, нужны разделам Mail/Product фронта.

## База данных

PostgreSQL 14+. Схема создаётся **автоматически при старте** (`src/lib/db.ts`, `CREATE TABLE IF NOT EXISTS`) — отдельные миграции для локального запуска не нужны.

- Основная БД `blog_app`: `users`, `posts`, `files`, `subscribers`, `model_releases`, `audit_logs`, `llm_stats_snapshots`, `chat_*`, `kanban_*`, `calendar_events`.
- Отдельная БД `dogs_teacher` (пул в `lib/dogs-db.ts`, своя автосхема): клиенты, слоты, заявки, push-подписки.
- В тестах (`NODE_ENV=test`) вместо реального Postgres поднимается **pg-mem** — поэтому `pg-mem` лежит в `dependencies` (его импортирует `lib/db.ts`).

## Локальный запуск

1. Поставить PostgreSQL (brew: `brew install postgresql@16 && brew services start postgresql@16`, либо Docker) и создать базы:

   ```sh
   createdb blog_app
   createdb dogs_teacher   # только если нужен dogs-teacher
   ```

2. Env: `cp .env.example .env`, минимум — `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL`.

3. Установка и старт:

   ```sh
   npm install   # или yarn
   npm run dev   # http://localhost:7272
   ```

4. Фронт (`blog-app-mui-frontend`) стартует на 3033 с `NEXT_PUBLIC_SERVER_URL=http://localhost:7272`.

На `http://localhost:7272/` отдаётся человекочитаемый индекс ручек.

### Переменные окружения

Полный шаблон — [.env.example](.env.example). По группам:

| Группа        | Переменные                                                                                                                                                                                                                           | Зачем                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| БД            | `DATABASE_URL`, `DOGS_DATABASE_URL`                                                                                                                                                                                                  | Подключения к `blog_app` и `dogs_teacher`           |
| JWT           | `JWT_SECRET`, `JWT_EXPIRES_IN`                                                                                                                                                                                                       | Подпись и срок жизни токенов                        |
| Email         | `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_SERVICE`                                                                                                                                                                                      | Gmail SMTP: коды подтверждения, рассылка            |
| URL'ы         | `FRONTEND_URL`, `BACKEND_URL`                                                                                                                                                                                                        | Ссылки в письмах, OAuth-редиректы                   |
| OAuth         | `GOOGLE_CLIENT_ID/SECRET`, `YANDEX_CLIENT_ID/SECRET`, `YANDEX_REDIRECT_URI`                                                                                                                                                          | Вход через Google/Яндекс                            |
| Новостной бот | `BOT_API_TOKEN` + `OWNER_EMAIL` (бот публикует посты от имени владельца), `BOT_CONTROL_URL` + `BOT_CONTROL_TOKEN` (админка → control-сервер бота)                                                                                    | Интеграция с `ai-bot-tg`                            |
| Dogs          | `DOGS_ADMIN_PASSWORD`, `DOGS_ADMIN_SESSION_SECRET`, `DOGS_TELEGRAM_BOT_TOKEN`, `DOGS_TELEGRAM_WEBHOOK_SECRET`, `DOGS_OWNER_TELEGRAM_ID`, `DOGS_SITE_URL`, `DOGS_TIMEZONE`, `DOGS_CONTACT_*`, `DOGS_VAPID_*`, `DOGS_REMINDERS_SECRET` | Запись к кинологу: админ, TG-бот, push, напоминания |

## Тесты

```sh
npm test              # все (Jest + Supertest, БД — pg-mem, ничего внешнего не нужно)
npm run test:watch
npm run test:coverage
npm test -- --testPathPattern=<имя-файла>   # один файл
```

Нужен `.env.test` (в репозитории): `JWT_SECRET=test_secret_key`, `NODE_ENV=test`.

Прочие проверки: `npm run ts` (tsc), `npm run lint` / `lint:fix`, `npm run build`.

## Деплой

**Push в `main` — это и есть деплой. Руками ничего делать не нужно.**

- CI: `.github/workflows/backend-cicd.yml` — тесты → scp на VDS `/opt/blog-app/backend/` → `.env.production` → `yarn install --frozen-lockfile` → `yarn build` → `systemctl restart blog-backend` → смоук холодного роута.
- Рантайм: systemd-юнит `blog-backend` (`next start -p 7272`), nginx проксирует `https://api.aifirst.us.com:8444` → 7272. Postgres и nginx на том же VDS.
- Мониторинг: `.github/workflows/prod-smoke.yml` — cron-смоук прода каждые 15 минут.

## Связанные проекты

- **blog-app-mui-frontend** — Next.js 15 фронт блога (Vercel, aifirst.us.com).
- **ai-bot-tg** — новостной бот: RSS → Claude → Telegram-аппрув → публикация через `POST /api/post/new` (сервис-токен `BOT_API_TOKEN`) и `POST /api/changelog/new`.
- **dogs-teacher** — фронт записи к кинологу (teacher.dog), ходит в `/api/dogs/*`.
