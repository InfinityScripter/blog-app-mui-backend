import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import {
  readCookie,
  CSRF_COOKIE,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  setAuthCookies,
  isSecureRequest,
  clearAuthCookies,
} from '@/src/lib/cookies';

function setCookieHeader(res: ReturnType<typeof createMocks>['res']): string[] {
  const raw = res.getHeader('Set-Cookie');
  if (Array.isArray(raw)) return raw as string[];
  return raw ? [String(raw)] : [];
}

describe('lib/cookies', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  });

  describe('isSecureRequest', () => {
    it('is true in production', () => {
      process.env.NODE_ENV = 'production';
      const { req } = createMocks({ method: 'GET' });
      expect(isSecureRequest(req)).toBe(true);
    });

    it('is false in dev over http', () => {
      process.env.NODE_ENV = 'development';
      const { req } = createMocks({ method: 'GET' });
      expect(isSecureRequest(req)).toBe(false);
    });

    it('honours X-Forwarded-Proto=https in non-prod', () => {
      process.env.NODE_ENV = 'development';
      const { req } = createMocks({ method: 'GET', headers: { 'x-forwarded-proto': 'https' } });
      expect(isSecureRequest(req)).toBe(true);
    });
  });

  describe('setAuthCookies (prod)', () => {
    it('sets Secure + SameSite=None on all three, HttpOnly only on access/refresh', () => {
      process.env.NODE_ENV = 'production';
      const { req, res } = createMocks({ method: 'POST' });
      setAuthCookies(req, res, { accessToken: 'AAA', refreshToken: 'RRR', csrfToken: 'CCC' });

      const cookies = setCookieHeader(res);
      const access = cookies.find((c) => c.startsWith(`${ACCESS_COOKIE}=`))!;
      const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
      const csrf = cookies.find((c) => c.startsWith(`${CSRF_COOKIE}=`))!;

      expect(access).toContain('AAA');
      expect(access).toContain('HttpOnly');
      expect(access).toContain('Secure');
      expect(access).toContain('SameSite=None');

      // Refresh cookie is path-scoped to /api/auth (not sent on every request).
      expect(refresh).toContain('RRR');
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/api/auth');
      expect(refresh).toContain('Secure');

      // CSRF cookie is readable by JS → NOT HttpOnly.
      expect(csrf).toContain('CCC');
      expect(csrf).not.toContain('HttpOnly');
      expect(csrf).toContain('Secure');
    });
  });

  describe('setAuthCookies (dev http)', () => {
    it('omits Secure and uses SameSite=Lax', () => {
      process.env.NODE_ENV = 'development';
      const { req, res } = createMocks({ method: 'POST' });
      setAuthCookies(req, res, { accessToken: 'AAA', refreshToken: 'RRR', csrfToken: 'CCC' });

      const access = setCookieHeader(res).find((c) => c.startsWith(`${ACCESS_COOKIE}=`))!;
      expect(access).not.toContain('Secure');
      expect(access).toContain('SameSite=Lax');
    });
  });

  describe('clearAuthCookies', () => {
    it('expires all three cookies (Max-Age=0)', () => {
      process.env.NODE_ENV = 'production';
      const { req, res } = createMocks({ method: 'POST' });
      clearAuthCookies(req, res);
      const cookies = setCookieHeader(res);
      expect(cookies).toHaveLength(3);
      cookies.forEach((c) => expect(c).toContain('Max-Age=0'));
    });
  });

  describe('appending onto an existing Set-Cookie', () => {
    it('preserves a pre-existing cookie header', () => {
      process.env.NODE_ENV = 'production';
      const { req, res } = createMocks({ method: 'GET' });
      res.setHeader('Set-Cookie', 'oauth_state=; Max-Age=0; Path=/x');
      setAuthCookies(req, res, { accessToken: 'A', refreshToken: 'R', csrfToken: 'C' });
      const cookies = setCookieHeader(res);
      expect(cookies.some((c) => c.startsWith('oauth_state='))).toBe(true);
      expect(cookies.some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(true);
      expect(cookies).toHaveLength(4);
    });
  });

  describe('readCookie', () => {
    it('reads a named cookie from the request header', () => {
      const { req } = createMocks({
        method: 'GET',
        headers: { cookie: `${ACCESS_COOKIE}=tok123; other=1` },
      });
      expect(readCookie(req, ACCESS_COOKIE)).toBe('tok123');
      expect(readCookie(req, 'other')).toBe('1');
      expect(readCookie(req, 'missing')).toBeUndefined();
    });

    it('returns undefined when there is no Cookie header', () => {
      const { req } = createMocks({ method: 'GET' });
      expect(readCookie(req, ACCESS_COOKIE)).toBeUndefined();
    });
  });
});
