# Бэклог

Сводка по состоянию репозитория на 2026-08-26. Источники: аудиты в `docs/`,
issues GitHub, сверка планов с фактическим кодом. Правило: закрытый пункт
переносится в «Закрыто» с указанием, чем именно закрыт.

## Открыто

### B-1. Prod smoke: issue #18 не закрывается после восстановления

- **Что:** [#18](https://github.com/InfinityScripter/blog-app-mui-backend/issues/18)
  открыт 15.08 воркфлоу `prod-smoke.yml`. Последний фейл — 21.08 12:15 UTC
  (504 на фронте + недоступный API), с тех пор комментариев нет — прод
  восстановился, смоук зелёный (проверено вручную 26.08: `/news/` → 307
  `Location: /en/news/` → 200).
- **Причина зависания:** воркфлоу умеет открывать issue и комментировать при
  фейле, но не закрывает его при восстановлении — #14 в июле закрывали руками.
- **Фикс:** шаг auto-close в `prod-smoke.yml` (в этой ветке). После мержа в
  `main` ближайший зелёный ран закроет #18 сам.

### B-2. Zod-валидация: остаток

Закрыто в этой ветке: домен `post` (new/edit/comments/publish),
`admin` (posts/[id], settings/auto-publish, settings/pd-collection),
остаток `auth` (reset-password, update-password, resend-verification, verify).

Осталось (низкий приоритет, по мере надобности):

- Query-валидация read-роутов (`post/list`, `post/search`, `post/details`,
  `post/latest`) — сейчас ручной парс с клампами (`parsePositiveInt`,
  `typeof === 'string'`), работает корректно; zod здесь — только унификация.
- OAuth-коллбеки (`auth/google/callback`, `auth/yandex/callback`) — query
  приходит от провайдера, валидируется фактическим обменом кода на токен.
- `admin/bot/*`, `admin/audit/ingest`, `dogs/telegram/webhook` — свои
  контракты (бот-токен, telegram secret); ревизия по мере изменений.

### B-3. Версионированные миграции БД — решение принято, следить за триггерами

Аудит (`docs/2026-06-20-bug-class-audit.md`, п. 3.2) требовал либо завести
миграции, либо явно задокументировать schema-as-code. Решение — schema-as-code,
зафиксировано в `docs/ARCHITECTURE.md` (раздел «Schema management»). Пункт
закрыт как решение; остаётся условие пересмотра: деструктивные изменения схемы
или второй инстанс приложения → перейти на нумерованные миграции.

## Закрыто ранее (сверка аудитов с кодом, 2026-08-26)

| Пункт аудита                                               | Чем закрыт                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| CORS два слоя, отражение любого origin (архит. аудит, п.1) | `src/utils/cors.ts` удалён, один слой: edge `src/middleware.ts` + `utils/allowed-origin.ts`                                     |
| Auth раздвоен, inline JWT + дефолт `secret123` (п.2)       | 0 inline `jsonwebtoken` в роутах; `requireAuth` в 35 роутах; секрет централизован в `src/lib/jwt.ts`, без дефолта               |
| Нет runtime-валидации (п.3)                                | zod-схемы `src/schemas/*` + `middlewares/validate.ts`; покрытие расширено этой веткой (см. B-2)                                 |
| Формат ответа непоследователен (п.4)                       | `src/utils/response.ts` (`ok`/`fail`/`sendError`); легаси-ключи (`{ post }`, `{ posts }`) сохранены намеренно — контракт фронта |
| Слой сервисов (п.5)                                        | `src/services/` — 30 сервисов, тонкие роуты                                                                                     |
| Email case-sensitivity + дубли (bug-class, п.1)            | `utils/normalize-email.ts` + уникальный индекс `users_email_lower_unique` на `LOWER(email)` (`src/lib/db.ts`)                   |
| Lockout (bug-class, 4.1)                                   | `MAX_FAILED_ATTEMPTS`/`isLocked` в `services/auth.ts`; разблокировка через reset-flow                                           |
| Enumeration-сообщения (4.2/4.3)                            | Нейтральные ответы в reset-password/resend-verification + fire-and-forget отправка почты (анти-timing-oracle)                   |
| Rate limiting                                              | `middlewares/rate-limit.ts` на 22 роутах                                                                                        |
| Индексы (bug-class, 3.3)                                   | 16 индексов в схеме, включая `posts_user_id_idx`, `posts_publish_idx`, GIN по тегам                                             |
| Audit trail (`2026-06-20-audit-logging-plan.md`)           | Таблица `audit_logs` + `services/audit.ts` + `utils/audit-context.ts`; admin-роуты просмотра                                    |
| Докеризация (`docs/plans/2026-06-20-dockerize-plan.md`)    | `Dockerfile` + `deploy/docker-compose.vds.yml`                                                                                  |
| Prod smoke #14 (июльский инцидент)                         | Закрыт 07.07                                                                                                                    |

## Как пользоваться

Новые задачи — сюда в «Открыто» с префиксом B-N, либо issue с меткой. Закрывая
пункт, указывай коммит/PR, которым он закрыт, и переноси строку в «Закрыто».
