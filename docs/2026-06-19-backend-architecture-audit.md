# Аудит архитектуры backend + план рефакторинга

Дата: 2026-06-19
Стек: Next.js 14 **Pages Router** API (`src/pages/api/`), 52 роута, PostgreSQL (class-based models в `src/models/`), JWT, `next-connect` частично, pg-mem в тестах.

> Готовых маркетплейс-скиллов под Pages Router API нет (все топовые — про App Router/RSC). План основан на ручном аудите этого кода + общих best practices Next.js API.

## Сводка находок

### 🔴 Критичное

**1. CORS сломан и небезопасен (два конфликтующих слоя).**
- `src/middleware.ts` — edge-middleware на все `/api/*`, ставит `Access-Control-Allow-Origin` по whitelist (правильно). НО содержит `console.log('origin is here', ...)` и `console.log('preflight ...')` (стр. 28, 30) — шум в проде.
- `src/utils/cors.ts` — per-route, отражает **ЛЮБОЙ** origin (`req.headers.origin ?? '*'`, `Cors({ origin: true })`) + `Access-Control-Allow-Credentials: true`.
- Каждый роут зовёт `await cors(req, res)` ПОСЛЕ middleware → **перезаписывает** whitelist на «любой origin». Итог: whitelist в middleware бесполезен, API фактически открыт всем источникам со credentials. Это CSRF-риск.

**2. Auth раздвоен (inline JWT vs requireAuth).**
- 33 роута используют `requireAuth`/`requireAuth(requireAdmin(...))` (правильный паттерн из `src/utils/auth.ts`).
- **10 роутов верифицируют JWT вручную** (`import { verify } from 'jsonwebtoken'`): `auth/*` (частично оправдано), `post/new`, `post/list`, `post/search`, `post/[id]/*`, `upload`, `file/delete`. Inline-копии повторяют логику auth.ts, расходятся (разные сообщения об ошибке, разный разбор `Bearer`).
- `const JWT_SECRET = process.env.JWT_SECRET || 'secret123'` — хардкод-дефолт повторён в каждом inline-роуте И в auth.ts/admin.ts. В проде при отсутствии env молча подставит слабый секрет `'secret123'` (вместо падения). Дыра.

### 🟡 Среднее

**3. Нет runtime-валидации.** Ноль zod/joi/yup. Ручные `if (!email || !password)` в каждом роуте, непоследовательно. `req.body` уходит в модель почти как есть.

**4. Response-формат непоследователен.** Встречаются `{ message, success, post }`, `{ accessToken, user }`, `{ posts }`, `{ post }`, `{ message, error }`. CLAUDE.md декларирует конвенцию `{ message, success: true, data }`, но код ей не следует. Клиенту приходится угадывать форму на каждом эндпоинте.

**5. CORS-дубль = лишняя работа на каждый запрос.** Edge-middleware + per-route `cors()` делают одно и то же дважды.

### 🟢 Что хорошо (не трогать)
- Models (`src/models/{User,Post,File}.ts`) — class + `buildWhere`/find-query, единообразно и чисто.
- `requireAuth`/`requireAdmin` композиция — правильный паттерн (просто применён не везде).
- pg-mem изоляция тестов, 44 backend-теста зелёные.
- Хелперы `toPublicUser`, `buildNewPostPayload`/`buildPostPatchPayload` — выносят повторяющуюся сборку payload.

## План рефакторинга (по приоритету, каждый пункт — отдельная ветка/PR)

### Задача 1 — Починить CORS (КРИТИЧНО, безопасность)
- Оставить ОДИН слой: edge `src/middleware.ts` с whitelist origin.
- Удалить per-route `await cors(req, res)` из всех роутов И сам `src/utils/cors.ts` (или оставить тонкий no-op для совместимости).
- Убрать `console.log` из middleware.
- Зафиксировать список origin в одном месте (env или константа), без `origin: true`.
- Проверка: preflight OPTIONS с разрешённого origin → 200 + корректный `Allow-Origin`; с чужого → без `Allow-Origin`. e2e (frontend) и SPA-preview CORS-тесты не падают.

### Задача 2 — Унифицировать auth (КРИТИЧНО)
- Перевести 10 inline-JWT роутов на `requireAuth` (`auth/*` оставить — там логин/верификация до токена).
- Вынести `JWT_SECRET` в один модуль `src/lib/jwt.ts` (или config): читать env, **бросать на старте если не задан** в production (не дефолтить `'secret123'`).
- `requireAuth` должен класть в `req.user` всё нужное (уже кладёт `_id`, `role`); где роуту нужен полный user — догружать через `User.findById(req.user._id)`.
- Проверка: все тесты зелёные; защищённые роуты без токена → 401.

### Задача 3 — Валидация через zod
- Ввести zod-схемы на `req.body` ключевых роутов (auth sign-in/sign-up, post new/edit). Тонкий хелпер `validate(schema)(handler)` или inline `schema.safeParse`.
- Невалидный body → 400 с понятным сообщением (поле + причина).
- Начать с auth и post, дальше по доменам.

### Задача 4 — Единый формат ответа
- Хелперы `ok(res, data, message?)` и `fail(res, status, message)` в `src/utils/response.ts`.
- Привести роуты к `{ success: boolean, message?, data? }` (как декларирует CLAUDE.md).
- Делать по доменам, синхронно правя frontend-потребителей (axios `endpoints`) где форма меняется.

### Задача 5 — Слой сервисов (опционально, после 1-4)
- Вынести бизнес-логику из route-handler в `src/services/<domain>.ts` (роут = только parse → validate → service → respond).
- Снижает дублирование, упрощает тесты (сервис тестируется без HTTP).

## Границы / заметки
- НЕ переписывать на App Router (Pages Router работает, миграция — отдельный большой проект).
- НЕ трогать models — они в порядке.
- Делать по одной задаче на ветку (как `fix/...`), отдельный PR, прогонять `npm test` + `npm run ts` перед merge.
- Backend деплоится авто-CI при push в main (`.github/workflows/backend-cicd.yml`) — мержить в main только проверенное.
