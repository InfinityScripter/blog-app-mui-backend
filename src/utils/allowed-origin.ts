// Single source of truth for CORS origin allow-listing.
// Used by both the edge middleware (src/middleware.ts) and the per-route
// CORS helper (src/utils/cors.ts) so the policy can't diverge.

export const allowedOrigins = [
  'http://localhost:3033',
  'http://localhost:7272',
  'https://blog-app-mui-frontend.vercel.app',
  'https://blog-git-main-sh0nyits-projects.vercel.app',
  'https://blog-app-mui-backend.onrender.com',
  'https://www.sh0ny.online',
  'https://sh0ny.ru',
  'https://talalaev.su',
  'https://www.talalaev.su',
];

/**
 * Returns true if the given Origin header value is allowed to receive CORS
 * credentials. Empty/undefined origins are NOT allowed (no wildcard echo).
 */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return isLocalOrigin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app');
}
