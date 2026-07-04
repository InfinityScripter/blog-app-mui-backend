// Human-readable API index served at "/". Plain JSX on purpose — this backend
// has no UI stack; the real reference lives in README.md.

type RouteGroup = {
  title: string;
  routes: { method: string; path: string; note?: string }[];
};

const GROUPS: RouteGroup[] = [
  {
    title: 'Auth',
    routes: [
      { method: 'POST', path: '/api/auth/sign-up' },
      { method: 'POST', path: '/api/auth/sign-in' },
      { method: 'GET', path: '/api/auth/me', note: 'JWT' },
      { method: 'POST', path: '/api/auth/verify' },
      { method: 'POST', path: '/api/auth/resend-verification' },
      { method: 'POST', path: '/api/auth/reset-password' },
      { method: 'POST', path: '/api/auth/update-password' },
      { method: 'GET', path: '/api/auth/google → /api/auth/google/callback', note: 'OAuth' },
      { method: 'GET', path: '/api/auth/yandex → /api/auth/yandex/callback', note: 'OAuth' },
    ],
  },
  {
    title: 'Blog',
    routes: [
      { method: 'GET', path: '/api/post/list' },
      { method: 'GET', path: '/api/post/details?title={slug}' },
      { method: 'GET', path: '/api/post/latest?title={slug}' },
      { method: 'GET', path: '/api/post/search?query={q}' },
      { method: 'POST', path: '/api/post/new', note: 'JWT' },
      { method: 'PATCH', path: '/api/post/{id}/edit', note: 'JWT, владелец' },
      { method: 'DELETE', path: '/api/post/{id}/delete', note: 'JWT, владелец' },
      { method: 'POST', path: '/api/post/{id}/publish', note: 'JWT' },
      { method: 'POST', path: '/api/post/{id}/view' },
      { method: 'POST/PUT/DELETE', path: '/api/post/{id}/comments', note: 'JWT' },
    ],
  },
  {
    title: 'Changelog (AI-релизы)',
    routes: [
      { method: 'GET', path: '/api/changelog/list' },
      { method: 'GET', path: '/api/changelog/{slug}' },
      { method: 'POST', path: '/api/changelog/new', note: 'admin/bot' },
    ],
  },
  {
    title: 'Newsletter',
    routes: [
      { method: 'POST', path: '/api/newsletter/subscribe' },
      { method: 'GET', path: '/api/newsletter/confirm?token={t}' },
      { method: 'GET', path: '/api/newsletter/unsubscribe?token={t}' },
      { method: 'POST', path: '/api/newsletter/send', note: 'admin' },
    ],
  },
  {
    title: 'Files',
    routes: [
      { method: 'POST', path: '/api/upload', note: 'JWT, multipart' },
      { method: 'GET', path: '/api/file/{id}' },
      { method: 'DELETE', path: '/api/file/delete?fileId={id}', note: 'JWT, владелец' },
    ],
  },
  {
    title: 'User / Admin',
    routes: [
      { method: 'PATCH', path: '/api/user/profile', note: 'JWT' },
      { method: 'POST/DELETE', path: '/api/user/avatar', note: 'JWT' },
      { method: 'POST', path: '/api/user/change-password', note: 'JWT' },
      { method: 'GET', path: '/api/admin/users · /audit-logs · /system-metrics', note: 'admin' },
      { method: '*', path: '/api/admin/bot/* · /api/admin/llm-stats/snapshot', note: 'admin' },
    ],
  },
  {
    title: 'Приложения (chat / kanban / calendar / dogs)',
    routes: [
      { method: '*', path: '/api/chat/channels · /api/chat/{channelId}/…', note: 'JWT' },
      { method: '*', path: '/api/kanban/boards · columns · tasks', note: 'JWT' },
      { method: '*', path: '/api/calendar/events', note: 'JWT' },
      { method: '*', path: '/api/dogs/… (booking, admin, push, telegram)', note: 'см. README' },
    ],
  },
];

const styles = {
  page: {
    margin: '0 auto',
    padding: '40px 24px',
    maxWidth: 760,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#1c2025',
    lineHeight: 1.5,
  },
  method: {
    display: 'inline-block',
    minWidth: 64,
    fontWeight: 700,
    color: '#0b6e4f',
  },
  note: { color: '#8a919b' },
  group: { margin: '24px 0 8px', fontSize: 18 },
} as const;

export default function IndexPage() {
  return (
    <main style={styles.page}>
      <h1>blog-app-mui-backend</h1>
      <p>
        Next.js API-сервер (порт 7272): блог, auth, changelog AI-моделей, рассылка, файлы, админка и
        запись к кинологу (dogs-teacher). Полное описание — в README.md репозитория.
      </p>
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h2 style={styles.group}>{group.title}</h2>
          <ul>
            {group.routes.map((route) => (
              <li key={route.path}>
                <span style={styles.method}>{route.method}</span> <code>{route.path}</code>
                {route.note ? <span style={styles.note}> — {route.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
