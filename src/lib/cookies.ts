import type { NextApiRequest, NextApiResponse } from 'next';

import { refreshExpiresInMs } from '@/src/lib/jwt';

// ----------------------------------------------------------------------
// Auth cookie transport. The access + refresh tokens ride in httpOnly cookies
// (JS can't read them → immune to XSS token theft, never in a URL). The CSRF
// token is a NON-httpOnly cookie the SPA reads and echoes back in a header
// (double-submit). Attribute choice depends on context:
//
//   prod / https  →  Secure; SameSite=None   (FE and API are on different
//                                              origins, so cookies are cross-site)
//   dev  / http   →  SameSite=Lax, no Secure  (browsers drop Secure cookies on
//                                              http, and SameSite=None needs Secure)

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';

// Access cookie is short-lived but we don't pin a Max-Age to the JWT exp — the
// cookie is a session cookie-ish 15m; the JWT's own exp is the real authority.
const ACCESS_MAX_AGE_MS = 15 * 60 * 1000;

// The refresh cookie is scoped to /api/auth so it's only ever sent to the auth
// endpoints (sign-out, refresh) — not attached to every API request.
const REFRESH_PATH = '/api/auth';

/**
 * True when the response should send Secure cookies. Prod always; otherwise
 * only when the request actually arrived over https (respecting a proxy's
 * X-Forwarded-Proto, since nginx terminates TLS in front of `next start`).
 */
export function isSecureRequest(req: NextApiRequest): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return proto === 'https';
}

interface CookieAttrs {
  maxAgeMs?: number;
  path?: string;
  httpOnly?: boolean;
}

/** Build one Set-Cookie string with context-appropriate Secure/SameSite. */
function buildCookie(
  name: string,
  value: string,
  secure: boolean,
  { maxAgeMs, path = '/', httpOnly = true }: CookieAttrs
): string {
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [`${name}=${value}`, `Path=${path}`, `SameSite=${sameSite}`];
  // When FE and API are on sibling subdomains (e.g. aifirst.us.com and
  // api.aifirst.us.com), COOKIE_DOMAIN='.aifirst.us.com' shares the auth cookies
  // across both so same-origin FE routes (e.g. /api/revalidate) can forward them
  // to the backend. Unset in dev → host-only cookie on localhost.
  const domain = process.env.COOKIE_DOMAIN;
  if (domain) parts.push(`Domain=${domain}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (typeof maxAgeMs === 'number') parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return parts.join('; ');
}

/** Merge new Set-Cookie header(s) onto whatever the response already has. */
function appendSetCookie(res: NextApiResponse, cookies: string[]): void {
  const existing = res.getHeader('Set-Cookie');
  const prior = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader('Set-Cookie', [...prior, ...cookies]);
}

interface AuthCookieValues {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

/** Set access + refresh + csrf cookies for an authenticated response. */
export function setAuthCookies(
  req: NextApiRequest,
  res: NextApiResponse,
  { accessToken, refreshToken, csrfToken }: AuthCookieValues
): void {
  const secure = isSecureRequest(req);
  appendSetCookie(res, [
    buildCookie(ACCESS_COOKIE, accessToken, secure, { maxAgeMs: ACCESS_MAX_AGE_MS }),
    buildCookie(REFRESH_COOKIE, refreshToken, secure, {
      maxAgeMs: refreshExpiresInMs(),
      path: REFRESH_PATH,
    }),
    // CSRF cookie is readable by JS on purpose (double-submit) → httpOnly:false.
    buildCookie(CSRF_COOKIE, csrfToken, secure, {
      maxAgeMs: refreshExpiresInMs(),
      httpOnly: false,
    }),
  ]);
}

/** Expire all three auth cookies (logout / failed refresh). */
export function clearAuthCookies(req: NextApiRequest, res: NextApiResponse): void {
  const secure = isSecureRequest(req);
  appendSetCookie(res, [
    buildCookie(ACCESS_COOKIE, '', secure, { maxAgeMs: 0 }),
    buildCookie(REFRESH_COOKIE, '', secure, { maxAgeMs: 0, path: REFRESH_PATH }),
    buildCookie(CSRF_COOKIE, '', secure, { maxAgeMs: 0, httpOnly: false }),
  ]);
}

/** Read a single cookie value from the request's Cookie header (or undefined). */
export function readCookie(req: NextApiRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const target = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!target) return undefined;
  return decodeURIComponent(target.slice(name.length + 1));
}
