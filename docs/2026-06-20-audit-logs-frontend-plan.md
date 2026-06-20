# План: фронт-страница `/dashboard/admin/audit-logs` (admin-only)

Страница в дашборде для просмотра audit-логов. **Только для админов.** Backend
уже готов (см. ниже) — это чисто фронтовая задача.

> **РЕПО:** всё ниже — во **frontend** репо `/Users/talalaev-m/projects/blog-app-mui-frontend`.
> Backend (`blog-app-mui-backend`) НЕ трогать — он уже отдаёт данные.

---

## Что уже готово на бэке (не делать, просто использовать)

- Эндпоинт **`GET /api/admin/audit-logs`** — гард `requireAuth(requireAdmin)` (403 не-админу, 401 без токена). Файл: `blog-app-mui-backend/src/pages/api/admin/audit-logs.ts`.
- Query-параметры (все опциональны): `action`, `actorId`, `targetType`, `limit` (default 50, cap 100), `offset` (default 0).
- **Форма ответа** (точная, проверено по `auditService.list`):
  ```json
  {
    "logs": [
      {
        "id": "uuid",
        "action": "post.created",
        "actorId": "uuid|null",
        "actorRole": "user|admin|null",
        "targetType": "post|user|kanban_task|...|null",
        "targetId": "string|null",
        "metadata": { "...": "non-PII" },
        "ip": "string|null",
        "requestId": "uuid|null",
        "createdAt": "2026-06-20T13:02:04.710Z"
      }
    ],
    "total": 123,
    "limit": 50,
    "offset": 0
  }
  ```
  Сортировка — newest-first (по `createdAt DESC`). Пагинация **серверная** (`limit`/`offset`/`total`) — НЕ клиентская.

---

## Файлы (frontend) — точный чеклист

### CREATE

**1. `src/app/dashboard/admin/audit-logs/page.tsx`** — тонкая client-страница, копия `src/app/dashboard/admin/users/page.tsx`:

```tsx
'use client';

import { useAuthContext } from 'src/auth/hooks';
import { RoleBasedGuard } from 'src/auth/guard';
import { AdminAuditLogsView } from 'src/sections/admin/admin-audit-logs-view';

export default function AdminAuditLogsPage() {
  const { user } = useAuthContext();
  return (
    <RoleBasedGuard currentRole={user?.role} acceptRoles={['admin']}>
      <AdminAuditLogsView />
    </RoleBasedGuard>
  );
}
```

Layout `src/app/dashboard/layout.tsx` уже оборачивает в `AuthGuard + DashboardLayout` — ничего не менять.

**2. `src/sections/admin/admin-audit-logs-view.tsx`** — `"use client"`, named export `AdminAuditLogsView`. Зеркалить `src/sections/admin/admin-posts-view.tsx` (Box + Typography h4 + Card + TableContainer + raw MUI Table). Внутри:

- фильтры-тулбар над Card: `action` (Select из списка известных действий), `targetType` (Select), `actorId` (TextField). Плейн MUI (НЕ RHF — RHF только для форм). State через `useState`/`useSetState` (`src/hooks/use-set-state`).
- таблица: колонки **Время / Действие / Актор (role) / Target / IP**. Дата — `new Date(createdAt).toLocaleString('ru-RU')`. `action` — `<Chip size="small">`. metadata — свернуть в `<Typography variant="caption">` (JSON.stringify, короткий).
- **серверная пагинация**: `TablePaginationCustom` (`src/components/table`) или MUI `TablePagination component="div"`; `page`/`rowsPerPage` → пересчёт в `limit = rowsPerPage`, `offset = page * rowsPerPage`, прокинуть в хук. `count = total` из ответа. Смена фильтра → сброс page в 0.
- empty state: `TableNoData` (`src/components/table`) или простой текст когда `logs.length === 0`.
- consts/types/utils рядом (по CLAUDE.md): `const.ts` (TABLE_HEAD, список action для Select), `types.ts` (AuditLog), `utils.ts` (если нужны хелперы маппинга). Section НЕ импортировать из других секций.

**3. (опц.) `src/sections/admin/audit-log-table-row.tsx`** — компонент строки `<TableRow>...`, если строка станет крупной. Иначе инлайн в view (как admin-posts).

### EDIT

**4. `src/routes/paths.ts`** — в interface `Paths` (≈строка 47-50) и в значение (≈96-99) добавить в `dashboard.admin`:

```ts
auditLogs: `${ROOTS.DASHBOARD}/admin/audit-logs`,
```

**5. `src/layouts/config-nav-dashboard.tsx`** — в блок `if (role === 'admin')` (≈строки 47-57, подзаголовок "Администрирование") добавить:

```ts
{ title: 'Журнал аудита', path: paths.dashboard.admin.auditLogs, icon: ICONS.dashboard },
```

(или завести новую иконку через `icon('ic-...')`). Видимость пункта уже гейтится по роли — `getNavData(user?.role)`.

**6. `src/utils/axios.ts`** — в блок `endpoints.admin` (≈79-83) добавить:

```ts
auditLogs: '/api/admin/audit-logs',
```

**7. `src/actions/admin.ts`** — добавить SWR-хук рядом с `useGetAdminUsers`:

```ts
interface AuditLog {
  id: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}
interface AuditLogsParams {
  action?: string;
  actorId?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}
interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export function useGetAuditLogs(params: AuditLogsParams, accessToken?: string) {
  // Mirror admin-posts-view race fix: explicit Bearer in key, null until token exists.
  const key = accessToken
    ? [endpoints.admin.auditLogs, { headers: { Authorization: `Bearer ${accessToken}` }, params }]
    : null;
  const { data, isLoading, error, mutate } = useSWR<AuditLogsResponse>(key, fetcher, swrOptions);
  return useMemo(
    () => ({
      auditLogs: data?.logs ?? [],
      auditLogsTotal: data?.total ?? 0,
      auditLogsLoading: isLoading,
      auditLogsError: error,
      auditLogsMutate: mutate,
    }),
    [data, isLoading, error, mutate]
  );
}
```

`accessToken` брать в view из `useAuthContext().user?.accessToken`.

---

## Гочи (важно — из recon)

1. **Race токена (admin-only!):** на свежем логине SWR может стартовать ДО `setSession` → запрос без `Authorization` → backend вернёт 401/403. **Обязательно** передавать токен явно в SWR-ключе и держать `key = null` пока токена нет (паттерн `admin-posts-view.tsx` строки 30-46). Не полагаться на глобальный `axios.defaults`.
2. **Пагинация серверная** — backend уже умеет `limit/offset/total`. НЕ тащить все логи и не резать на клиенте (таблица может расти). `count` для пагинатора = `total` из ответа.
3. **SWR-ключ — кортеж** `[url, { params, headers }]`; SWR кэширует по deep-equal → смена любого фильтра/страницы рефетчит сам. Убирать `undefined`-поля из `params` чтобы ключ был стабилен.
4. **`src/components/table`** — готовый тулкит (`useTable`, `TableHeadCustom`, `TablePaginationCustom`, `TableNoData`), но пока НЕ используется нигде. Можно стать первым консьюмером ИЛИ для скорости зеркалить raw-MUI-Table из `admin-posts-view.tsx`. Если useTable — учти что его сортировка/слайс клиентские; для серверной пагинации использовать только page/rowsPerPage state, а данные слайсить на бэке.
5. **House style:** ru-лейблы, `<Chip size="small">` для статуса/action, даты `toLocaleString('ru-RU')`. Топ-фильтры — плейн MUI (НЕ RHF).
6. **PII:** metadata с бэка уже без PII (только ids/enums/counts). Просто показывать как есть.
7. **RoleBasedGuard** блокирует только когда `currentRole` truthy и не в `acceptRoles`; во время загрузки `user` (undefined) пропускает — но родительский `AuthGuard` это покрывает. Двойная защита: + nav-пункт виден только админу, + backend 403. ОК.

---

## Verify (в конце)

1. `npm run lint:fix` + `npm run ts` (в frontend) — чисто.
2. Запустить backend (:7272) + frontend (`npm run dev`, :3033).
3. Залогиниться **админом** (`mtal-va@mail.ru`) → меню "Журнал аудита" видно → страница грузит логи.
4. Залогиниться **обычным юзером** → пункта меню НЕТ, прямой переход на `/dashboard/admin/audit-logs` → RoleBasedGuard "Permission denied".
5. Проверить фильтры (action/targetType) + пагинацию (next page шлёт offset).
6. e2e (если добавляешь тест) — по желанию.

## Деплой

Фронт → Vercel авто на push в main (frontend репо). Backend не трогается.

```

```
