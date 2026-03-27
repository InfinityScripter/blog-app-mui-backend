# Backend Setup With PostgreSQL

Этот backend больше не использует MongoDB. Теперь он работает с PostgreSQL через `DATABASE_URL`.

Ниже инструкция от нуля до рабочего состояния, в котором:

- PostgreSQL установлен и запущен
- backend подключается к базе
- frontend видит backend
- вы можете создавать и просматривать посты

## Что нужно установить

Минимум:

- Node.js 20.x
- PostgreSQL 14+ или 15+ рекомендуется

Опционально, но очень удобно:

- `psql` для проверки базы из терминала
- DBeaver / TablePlus / pgAdmin для просмотра таблиц и данных
- Docker Desktop, если не хотите ставить PostgreSQL системно

## Вариант 1. Установить PostgreSQL на macOS через Homebrew

Если у вас macOS, самый простой путь:

```sh
brew install postgresql@16
brew services start postgresql@16
```

Проверить, что сервис поднялся:

```sh
brew services list | grep postgresql
```

Проверить, что `psql` доступен:

```sh
psql --version
```

## Вариант 2. Поднять PostgreSQL в Docker

Если удобнее через Docker:

```sh
docker run --name blog-app-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=blog_app \
  -p 5432:5432 \
  -d postgres:16
```

Проверить контейнер:

```sh
docker ps
```

## Создать базу данных вручную

Если PostgreSQL уже установлен, создайте базу:

```sh
createdb blog_app
```

Или через `psql`:

```sql
CREATE DATABASE blog_app;
```

Для тестов при желании можно создать отдельную базу:

```sql
CREATE DATABASE blog_app_test;
```

Важно: в текущем проекте тесты используют `pg-mem`, поэтому реальная тестовая база не обязательна. Но для локальной разработки `blog_app` нужна.

## Настроить переменные окружения backend

Скопируйте [backend/.env.example](/Users/kot/projects/blog-app-mui/backend/.env.example) в локальный `.env` и заполните значения под себя.

```sh
cp .env.example .env
```

Файл для локальной настройки:

[backend/.env.example](/Users/kot/projects/blog-app-mui/backend/.env.example)

Минимально важные переменные:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/blog_app
JWT_SECRET=secret123
JWT_EXPIRES_IN='3 days'
FRONTEND_URL=http://localhost:3033
```

Если у вас другой пользователь/пароль/порт, измените `DATABASE_URL`.

Примеры:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/blog_app
DATABASE_URL=postgresql://myuser:mypassword@localhost:5432/blog_app
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/blog_app
```

## Как backend создаёт таблицы

В проекте уже есть автоинициализация схемы в [backend/src/lib/db.ts](/Users/kot/projects/blog-app-mui/backend/src/lib/db.ts).

Это значит:

- отдельный ручной SQL-migration для первого локального запуска не нужен
- если `DATABASE_URL` валиден и PostgreSQL доступен, таблицы создадутся автоматически

Основные таблицы:

- `users`
- `posts`
- `files`

## Установить зависимости backend

Перейдите в backend:

```sh
cd /Users/kot/projects/blog-app-mui/backend
```

Установка через npm:

```sh
npm install
```

Или через Yarn:

```sh
yarn install
```

## Запустить backend

```sh
npm run dev
```

или

```sh
yarn dev
```

Backend стартует на:

```txt
http://localhost:7272
```

## Как проверить, что backend реально подключился к PostgreSQL

### Способ 1. Проверить через psql

Подключение:

```sh
psql postgresql://postgres:postgres@localhost:5432/blog_app
```

Посмотреть таблицы:

```sql
\dt
```

Вы должны увидеть примерно:

- `users`
- `posts`
- `files`

Посмотреть посты:

```sql
SELECT id, title, publish, created_at
FROM posts
ORDER BY created_at DESC;
```

Посмотреть пользователей:

```sql
SELECT id, email, name, is_email_verified
FROM users
ORDER BY created_at DESC;
```

### Способ 2. Через GUI-клиент

Подключите DBeaver / TablePlus / pgAdmin со следующими параметрами:

- Host: `localhost`
- Port: `5432`
- Database: `blog_app`
- User: `postgres`
- Password: `postgres`

После подключения откройте таблицу `posts`.

## Как запустить frontend, чтобы увидеть посты

Перейдите в frontend:

```sh
cd /Users/kot/projects/blog-app-mui/frontend
```

Проверьте файл [frontend/.env](/Users/kot/projects/blog-app-mui/frontend/.env):

```env
NEXT_PUBLIC_SERVER_URL=http://localhost:7272
NEXT_PUBLIC_ASSET_URL=http://localhost:7272
```

Запустите frontend:

```sh
npm run dev
```

или

```sh
yarn dev
```

Frontend будет доступен на:

```txt
http://localhost:3033
```

## Что сделать, чтобы реально увидеть посты

Важно: после перехода на PostgreSQL старая MongoDB-база автоматически не переносится.

Это значит:

- если база `blog_app` новая и пустая, постов в интерфейсе не будет
- чтобы увидеть посты, нужно либо создать их заново через UI, либо отдельно перенести данные из MongoDB в PostgreSQL

Самый простой путь без data migration:

1. Запустите backend
2. Запустите frontend
3. Зарегистрируйте пользователя
4. Войдите
5. Создайте новый пост через dashboard
6. Откройте список постов или публичную страницу постов

После этого посты появятся:

- в интерфейсе
- в таблице `posts` PostgreSQL

## Как понять, почему посты не видны

### Ситуация 1. Backend не подключился к PostgreSQL

Проверьте:

- запущен ли PostgreSQL
- существует ли база `blog_app`
- правильный ли `DATABASE_URL`
- не занят ли порт `5432`

### Ситуация 2. Frontend смотрит не туда

Проверьте:

- [frontend/.env](/Users/kot/projects/blog-app-mui/frontend/.env)
- `NEXT_PUBLIC_SERVER_URL=http://localhost:7272`
- backend реально запущен на `7272`

### Ситуация 3. База пустая

Проверьте SQL-запросом:

```sql
SELECT COUNT(*) FROM posts;
```

Если `0`, значит постов ещё нет в PostgreSQL.

### Ситуация 4. Пользователь не видит свои draft-посты

Логика API сейчас такая:

- неавторизованные пользователи видят только `published`
- авторизованный пользователь видит свои посты, включая `draft`

Поэтому для проверки:

- либо публикуйте пост
- либо входите под тем же пользователем, который его создал

## Проверка backend после миграции

Сборка:

```sh
npm run build
```

Тесты:

```sh
npm test -- --runInBand
```

Обе команды уже должны проходить в текущем состоянии проекта.

## Что ещё не сделано автоматически

Код проекта уже переведён на PostgreSQL, но автоматический перенос старых данных из MongoDB в PostgreSQL ещё не добавлен.

Если у вас в Mongo были важные посты, пользователи или файлы, нужен отдельный migration-скрипт:

1. читать данные из MongoDB
2. преобразовывать их в новую PostgreSQL-схему
3. загружать в `users`, `posts`, `files`

## Краткий сценарий запуска без лишнего

Если коротко, то рабочая последовательность такая:

1. Установить PostgreSQL
2. Создать базу `blog_app`
3. В [backend/.env](/Users/kot/projects/blog-app-mui/backend/.env) прописать `DATABASE_URL`
4. Запустить backend: `npm run dev`
5. Проверить frontend env: [frontend/.env](/Users/kot/projects/blog-app-mui/frontend/.env)
6. Запустить frontend: `npm run dev`
7. Зайти в UI и создать/открыть посты

Если хотите, следующим шагом я могу ещё сделать отдельный migration-скрипт из вашей старой MongoDB в PostgreSQL, чтобы в новой базе сразу появились старые посты.
