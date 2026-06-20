# Audit Logging — план (production-grade audit trail)

**Цель:** взрослое прод-логирование действий — кто / что / когда по каждому
мутирующему действию (post.created, user.deleted, auth.login…). Семантический
audit trail на уровне бизнес-действий, не сырой row-dump.

**Решения (согласовано с пользователем):**

- Глубина: **audit trail действий** (не row-CDC, не HTTP-лог пока).
- Хранилище: **таблица `audit_logs` в Postgres** (schema-as-code в `db.ts`).
- Механизм: **явный `auditService`**, вызывается из роутов/сервисов.
- Библиотека: **своя**, без внешних audit-либ (они под ORM — не лягут на голый
  `pg` + слоёную архитектуру). `pino` — опция фазы 3 (HTTP-лог), пока не нужна.

Основано на recon (workflow `audit-logging-recon`): инвентарь действий, auth-
контекст, db-слой — всё проверено по коду.

---

## 1. Таблица `audit_logs` (append к `schemaSql` в `src/lib/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,                              -- uuidv4(), app-side
  action      TEXT NOT NULL,                                 -- dot.case событие
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,  -- NULL для анонима
  actor_role  TEXT,                                          -- 'user'|'admin'|NULL (денорм, без FK)
  target_type TEXT,                                          -- 'post'|'user'|'kanban_task'…
  target_id   TEXT,                                          -- plain TEXT, БЕЗ FK (target часто удаляется в том же действии)
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,            -- только non-PII контекст
  ip          TEXT,                                          -- nullable, best-effort
  request_id  TEXT,                                          -- uuid корреляции, nullable
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx   ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx     ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx     ON audit_logs (target_type, target_id);
```

**Решения по схеме (важно):**

- `target_id` — plain TEXT, **БЕЗ FK**: target (post/user) часто удаляется тем же
  действием → FK заблокировал бы insert или обнулил бы значение.
- `actor_id` — FK `ON DELETE SET NULL`: удаление юзера НЕ стирает trail.
- `actor_role` — денормализован: роль на момент действия переживает смену роли.
- Все индексы — plain btree по скаляру → безопасно под pg-mem.
- **НЕТ GIN/expression-индекса** на `metadata` в `schemaSql` (бросит под pg-mem →
  уронит boot/тесты). Если понадобится JSONB-поиск — в `applySafeMigrations`.
- В `resetDatabase()` добавить `DELETE FROM audit_logs` **перед** `users` (child→parent).

**Boot-safety (урок прод-инцидента):** новая `CREATE TABLE IF NOT EXISTS` + btree —
безопасны (нечему конфликтовать) → в `schemaSql`. Любое data-conditional (unique,
партиции, GIN) → ТОЛЬКО в `applySafeMigrations` (try/catch, не валит boot).

---

## 2. `auditService` (`src/services/audit.ts`)

```ts
export interface AuditContext {
  actorId?: string | null;
  actorRole?: string | null;
  ip?: string | null;
  requestId?: string | null;
}
export interface AuditRecord extends AuditContext {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

// Fire-and-forget. НИКОГДА не бросает, НИКОГДА не await в бизнес-пути.
export function record(rec: AuditRecord): void {
  const id = uuidv4();
  dbQuery(INSERT_SQL, params).catch((err) =>
    console.error('[audit] insert failed', rec.action, err)
  );
}
export const auditService = { record };
```

**Ключевое:** `record()` → `void`, внутри `dbQuery(...).catch(...)`. Бизнес-действие
НЕ ждёт audit и НЕ откатывается если insert упал. Best-effort — как
`applySafeMigrations`. Параметризованный INSERT, `metadata` → JSON.stringify.

---

## 3. Поток actor + ip + request_id

Сервисы сегодня получают только `actorId: string` (роль/ip/req не доходят).
Поэтому **захват в роуте**, не в сервисах (Option A — без правки сигнатур):

```
requireAuth → req.user = { _id, role }   (401 до handler если нет токена)

handler:
  ctx = { actorId: req.user?._id ?? null,    // null на public/anon
          actorRole: req.user?.role ?? null,
          ip: getClientIp(req),
          requestId: req.requestId ?? uuidv4() }
  result = await postService.createPost(req.user!._id, req.body)   // сигнатура НЕ меняется
  auditService.record({ action:'post.created', ...ctx,
    targetType:'post', targetId: result.id, metadata:{ title: result.title } })
```

- **Аноним:** public-роуты (`view.ts`, sign-in) → `actorId: null`. Nullable + SET NULL делают запись валидной.
- **`auth.login.*`:** особый — `req.user` ещё нет (логин создаёт сессию). sign-in-роут зовёт `record()` сам: actorId из найденного юзера (успех) / null (фейл).
- **IP:** новый `getClientIp(req)` в `src/utils` — `x-forwarded-for` первый элемент, fallback `req.socket.remoteAddress`, иначе null.
- **request_id:** минтим `uuidv4()`. Чтобы покрыть весь запрос — стащить `req.requestId = uuidv4()` в `requireAuth`; на anon-роутах минтить инлайн.

---

## 4. Инвентарь событий (dot.case → service.fn)

Только мутации. Чистые чтения (`list*`, `getBoard`, `searchPosts`) — ничего.

| Домен    | Событие                                                              | service.fn                                                     |
| -------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| auth     | `auth.login.succeeded` / `auth.login.failed` / `auth.account.locked` | `auth.signIn` (ветки)                                          |
| user     | `user.deleted`                                                       | `admin.deleteUser`                                             |
| post     | `post.created`                                                       | `post.createPost`                                              |
| post     | `post.updated`                                                       | `post.updatePost`                                              |
| post     | `post.deleted`                                                       | `post.deletePost`                                              |
| post     | `post.published` / `post.unpublished`                                | `post.setPublish` (ветка по publish)                           |
| comment  | `comment.created/updated/deleted`                                    | `comment.add/edit/deleteComment`                               |
| calendar | `calendar.event.created/updated/deleted`                             | `calendar.create/update/deleteEvent`                           |
| chat     | `chat.channel.created`                                               | `chat.createChannel`                                           |
| chat     | `chat.message.sent` ⚠️                                               | `chat.sendMessage` (high-volume — решить: сэмпл/исключить)     |
| kanban   | `kanban.board.created/deleted`                                       | `kanban.create/deleteBoard`                                    |
| kanban   | `kanban.column.created/deleted`                                      | `kanban.add/deleteColumn`                                      |
| kanban   | `kanban.task.created/deleted`                                        | `kanban.add/deleteTask`                                        |
| kanban   | `kanban.task.updated` / `kanban.task.moved`                          | `kanban.updateTask` (`.moved` если в patch column_id/position) |

**Исключено намеренно:**

- `post.viewed` (`incrementViews`) — анонимный счётчик каждого хита, не audit-grade, раздует таблицу. НЕ логируем.
- `chat.message.sent` — high-volume, флаг на продукт-решение (по умолчанию пока логируем, легко выключить).

---

## 5. Риски / гочи (этого кодбейса)

1. **Прод-boot:** новая таблица в `schemaSql` ок; data-conditional → только `applySafeMigrations`. (Главный урок.)
2. **pg-mem:** тот же `schemaSql` под pg-mem; один неподдержанный стейтмент → падают все тесты. НЕТ GIN, нет `@>`/`jsonb_path_query` в тест-запросах. После добавления — `npm test`.
3. **Fire-and-forget:** insert обязан быть `.catch()` + не-await. Если кто-то заawait'ит — транзиентный сбой БД сломает создание поста/логин. Best-effort.
4. **IP за nginx:** `req.socket.remoteAddress` = loopback nginx. Реальный IP только если nginx шлёт `X-Forwarded-For`/`X-Real-IP`. **Проверить nginx-conf на VDS до доверия полю.** Пока — nullable, не гейтить на нём (XFF спуфится).
5. **PII / GDPR:** `actor_id` SET NULL → trail переживает юзера → `metadata` НЕ должен содержать PII (email/имя/тело сообщения/контент). Для `auth.login.failed` — email только если продукт ок (enumeration-sensitive); лучше хеш/опустить. metadata = ids, enums, имена-полей, счётчики.
6. **`task.updated` vs `.moved`:** различать в роуте (patch сервиса непрозрачен) — по наличию column_id/position в `req.body`.
7. **Anon-роуты без requireAuth** → нет `req.requestId` → минтить инлайн, иначе request_id молча null.

---

## Фазы

### Фаза 1 — фундамент (СТАРТ СРАЗУ)

- `audit_logs` в `schemaSql` + индексы + `resetDatabase()`.
- `src/services/audit.ts` (`record`, fire-and-forget).
- `getClientIp(req)` в `src/utils`.
- `req.requestId` в `requireAuth` (+ тип).
- `buildAuditContext(req)` helper.
- TDD: `audit.test.ts` — record пишет строку; не бросает при сбое dbQuery; аноним (actorId null) валиден; metadata сериализуется.
- Verify: `npm test` (все зелёные + новые), `tsc`, lint. Merge через ветку.

### Фаза 2 — интеграция событий

- Подключить `record()` во все роуты из §4 (post, comment, kanban, calendar, chat, admin, auth-sign-in).
- `auth.login.*` в sign-in-роуте (success/failed/locked).
- TDD на каждый домен (роут эмитит правильный action+target).
- Verify: unit + e2e 13/13 (функционал не сломан) + CI.

### Фаза 3 — просмотр + ретеншн (опц.)

- Admin-эндпоинт `GET /api/admin/audit-logs` (фильтры action/actor/date, пагинация, `requireAdmin`).
- Опц.: фронт-страница в дашборде (admin).
- Опц.: ретеншн (чистка > N дней) — отдельный скрипт/cron, НЕ в boot.
- Опц.: `pino` HTTP request-log если захочется.

---

## Verify-дисциплина (каждая фаза)

TDD (RED→GREEN) → полный Jest зелёный → tsc + lint → e2e 13/13 (там где трогаем
роуты) → отдельная ветка → `--no-ff` merge → push → CI deploy success → smoke прод.
