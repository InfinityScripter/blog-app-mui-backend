// Single source of truth for CORS origin allow-listing.
// Used by the edge CORS middleware (src/middleware.ts).

export const allowedOrigins = [
  'http://localhost:3033',
  'http://localhost:7272',
  'https://aifirst.us.com',
  'https://www.aifirst.us.com',
  'https://teacher.dog',
  'https://www.teacher.dog',
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
