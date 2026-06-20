# Bug-class audit — 2026-06-20

Архитектурный аудит классов багов, спровоцированный реальным прод-багом:
в таблице `users` живут **два аккаунта одного человека** — `Mtal-va@mail.ru` и
`mtal-va@mail.ru`. Причина — email хранится и сравнивается **регистрозависимо**,
без нормализации.

Метод: read-only обход `src/services`, `src/pages/api`, `src/models`,
`src/schemas`, `src/lib/db.ts`. Прод не изменялся. Severity: critical / high /
medium / low.

---

## 1. Email case-sensitivity + дубли аккаунтов (КОРНЕВАЯ ПРОБЛЕМА)

Email нигде не приводится к нижнему регистру — ни на запись, ни на чтение, ни на
уровне БД. Это сразу три независимых дефекта, любого хватает для дубля.

| #   | Где                                            | Код                                                                                                                         | Severity     |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1.1 | `src/schemas/auth.ts:6,13`                     | `z.string().trim().email()` — есть `.trim()`, нет `.toLowerCase()`                                                          | **critical** |
| 1.2 | `src/pages/api/auth/sign-up.ts:44,57`          | `email.trim()` на lookup и на запись — регистр сохраняется                                                                  | **critical** |
| 1.3 | `src/models/User.ts` (buildWhere, ветка email) | `email = $N` — точное сравнение, регистрозависимое                                                                          | **critical** |
| 1.4 | `src/lib/db.ts:12`                             | `email TEXT NOT NULL UNIQUE` — UNIQUE по `text` регистрозависим; `Mtal-va` и `mtal-va` для Postgres разные → дубль проходит | **critical** |
| 1.5 | `src/pages/api/auth/reset-password.ts:27`      | `findOne({ email: email.trim() })` без lowercase → юзер `Mtal-va` не сбросит пароль, введя `mtal-va`                        | high         |
| 1.6 | `src/pages/api/auth/verify-email.ts:23`        | то же                                                                                                                       | high         |
| 1.7 | `src/pages/api/auth/resend-verification.ts:23` | `findOne({ email })` — даже без trim                                                                                        | high         |
| 1.8 | `src/pages/api/auth/yandex/callback.ts:125`    | `findOne({ email })` (OAuth) — сырой email от провайдера                                                                    | high         |
| 1.9 | `src/pages/api/auth/google/callback.ts`        | проверить OAuth email на ту же нормализацию                                                                                 | high         |

**Фикс (порядок важен — данные раньше констрейнта):**

1. Нормализовать на ВХОДЕ: в zod-схемах `.trim().toLowerCase()`; добавить
   `src/utils/normalize-email.ts` и применять в OAuth-колбэках, где zod нет.
2. Нормализовать на LOOKUP: любой `findOne({email})` принимает уже
   нормализованный email (или делать `LOWER(email) = LOWER($N)` в модели).
3. **Сначала смержить существующие прод-дубли**, потом ставить констрейнт —
   иначе миграция упадёт. Кандидаты: `Mtal-va@mail.ru` + `mtal-va@mail.ru`.
4. Заменить регистрозависимый UNIQUE: либо тип `citext` для `email`, либо
   `CREATE UNIQUE INDEX ON users (LOWER(email))`.

> Только write-side НЕ достаточно: без шага 3–4 новый дубль всё равно
> проскочит через прямой insert/OAuth, а старые дубли останутся.

---

## 2. Покрытие валидации (zod) — почти нулевое вне auth

`validateBody` (`src/utils/validate.ts`) используется **только** в
`auth/sign-in.ts`. `sign-up` валидирует вручную. Все остальные ~24 роута читают
`req.body` / `req.query` без схемы.

| Домен    | Роуты без валидации (body/query)                                                       | Severity |
| -------- | -------------------------------------------------------------------------------------- | -------- |
| auth     | verify, verify-email, resend-verification, reset-password, update-password, test-email | high     |
| post     | new, update, edit, publish, comments, delete, search, details, latest                  | medium   |
| kanban   | boards, columns, tasks (+ вложенные `[id]`)                                            | medium   |
| chat     | channels, messages                                                                     | medium   |
| calendar | events, events/[id]                                                                    | medium   |
| admin    | posts/[id], users/[id]                                                                 | medium   |
| file     | [id], delete                                                                           | medium   |

Доп. дефекты helper'а:

- `validateBody` валидирует **только body**, не `req.query`. Все `[id]`,
  `?dashboard`, `?publish` идут без проверки типа/наличия. (medium)
- Нет единой схемы для path-параметров (id). (low)

**Фикс:** завести `src/schemas/{post,kanban,chat,calendar}.ts`; добавить
`validateQuery`; обернуть роуты. Тонкие роуты + сервисы уже готовы это принять.

---

## 3. Целостность БД

Хорошие новости: схема — **schema-as-code** в `src/lib/db.ts` (идемпотентные
`CREATE TABLE IF NOT EXISTS` + `ALTER ... ADD COLUMN IF NOT EXISTS`), не ad-hoc.
FK с `ON DELETE CASCADE`/`SET NULL` расставлены, `CHECK` на `role` и `publish`
есть. Это сильная сторона.

| #   | Где                                            | Проблема                                                                                                                  | Severity     |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 3.1 | `users.email` (`db.ts:12`)                     | UNIQUE регистрозависим — см. раздел 1                                                                                     | **critical** |
| 3.2 | нет миграционного механизма с версионированием | `db.ts` накатывается на старте, но нет истории/rollback; «миграция» дублей делается руками                                | medium       |
| 3.3 | индексы                                        | проверить наличие индекса на `posts.user_id`, `posts.publish` (частые фильтры в list/search); FK создаёт индекс не всегда | low          |
| 3.4 | `users` уникальность только по email           | при переходе на `LOWER(email)` unique-index — единый источник истины                                                      | (входит в 1) |

**Фикс:** п.1 закрывает 3.1. Для 3.2 — либо принять schema-as-code как
осознанный выбор и задокументировать, либо завести лёгкие нумерованные
SQL-миграции. 3.3 — добавить индексы под реальные запросы.

---

## 4. Auth / безопасность

| #   | Где                                       | Проблема                                                                                                                                                   | Severity |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 4.1 | `src/services/auth.ts` (sign-in)          | **lockout не enforced**: колонки `failed_login_attempts` / `is_locked` существуют, но sign-in их не инкрементит и не проверяет → нет защиты от brute-force | high     |
| 4.2 | `src/pages/api/auth/reset-password.ts:29` | «No user found with that email» → **user enumeration**: подтверждает наличие/отсутствие email                                                              | high     |
| 4.3 | `src/pages/api/auth/sign-up.ts:46`        | «User with this email already exists» → enumeration                                                                                                        | medium   |
| 4.4 | прод-данные                               | в проде **нет ни одного admin** (все `role='user'`), включая владельца → «All posts» не работает; вероятно seed-пропуск                                    | medium   |
| 4.5 | дубли аккаунтов (разд.1)                  | один человек = два аккаунта → путаница прав/владения, расщепление истории                                                                                  | high     |
| 4.6 | `src/pages/api/auth/test-email.ts`        | dev-эндпоинт в проде? проверить, что закрыт/удалён                                                                                                         | medium   |

Хорошее (оставить как есть):

- sign-in отдаёт одинаковое «Wrong email or password» для «нет юзера» и
  «неверный пароль» — корректно (`services/auth.ts:18,25`).
- `toPublicUser` (`src/utils/public-user.ts`) не пропускает `passwordHash` /
  коды / токены — утечки чувствительных колонок нет.
- bcrypt cost = 10 — приемлемо.
- JWT payload = `{userId, role}` — PII не утекает; secret fail-fast в prod.

**Фикс:** 4.1 — инкремент failed-attempts + блок после N в `authService.signIn`.
4.2/4.3 — нейтральные сообщения («если email зарегистрирован, отправлено
письмо»). 4.4 — выдать admin владельцу (отдельным подтверждённым SQL). 4.6 —
закрыть/удалить test-email.

---

## Приоритеты исправления

1. **Email-нормализация (раздел 1)** — critical, корень дубля. Нормализация на
   входе + lookup, дедуп прод-дублей, `LOWER(email)` unique / citext.
2. **Lockout enforcement (4.1)** — high, реальная brute-force поверхность.
3. **Enumeration-сообщения (4.2/4.3)** — нейтрализовать.
4. **Валидация query + остальные домены (раздел 2)** — постепенно, по домену.
5. **Admin-seed (4.4)** + закрыть test-email (4.6).
6. **Индексы / миграции (3.2/3.3)** — по мере роста.

Прод-данные (дедуп дублей, выдача admin) — **только с явным подтверждением**,
бэкап перед DDL.
