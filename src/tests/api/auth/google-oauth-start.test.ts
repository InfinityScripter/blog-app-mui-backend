import type { NextApiHandler } from 'next';

import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// The Google strategy is built at import time and OAuth2Strategy throws without a
// clientID, so the creds must be in the env before `@/src/lib/passport` is pulled
// in (hence the dynamic import below). BACKEND_URL is pinned so the callbackURL
// baked into the strategy is deterministic on any machine.
process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.BACKEND_URL = 'http://localhost:7272';

const STATE_COOKIE = 'oauth_state_google';

let startHandler: NextApiHandler;

beforeAll(async () => {
  ({ default: startHandler } = await import('@/src/pages/api/auth/google'));
});

type MockRes = ReturnType<typeof createMocks>['res'];

function setCookies(res: MockRes): string[] {
  const raw = res.getHeader('Set-Cookie');
  return Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
}

describe('GET /api/auth/google (OAuth start)', () => {
  it('redirects to Google with the state it just pinned in the cookie', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET, url: '/api/auth/google' });

    await startHandler(req, res);

    expect(res._getStatusCode()).toBe(302);
    const location = String(res.getHeader('Location'));
    expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);

    const params = new URL(location).searchParams;
    expect(params.get('client_id')).toBe('test-google-client');
    expect(params.get('redirect_uri')).toBe('http://localhost:7272/api/auth/google/callback');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('profile email');

    // The whole CSRF guarantee of the flow: the state Google will echo back to the
    // callback must be the one pinned in the HttpOnly cookie on THIS response.
    const stateCookie = setCookies(res).find((cookie) => cookie.startsWith(`${STATE_COOKIE}=`));
    expect(stateCookie).toBeDefined();
    const cookieState = stateCookie!.split(';')[0].slice(STATE_COOKIE.length + 1);
    expect(cookieState).not.toBe('');
    expect(params.get('state')).toBe(cookieState);

    expect(stateCookie).toContain('Max-Age=600');
    expect(stateCookie).toContain('Path=/api/auth/google/callback');
    expect(stateCookie).toContain('HttpOnly');
    expect(stateCookie).toContain('SameSite=Lax');
  });

  it('does not start a flow for a non-GET method', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.POST, url: '/api/auth/google' });

    await startHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
    // No redirect to Google and no state pinned — nothing was set in motion.
    expect(res.getHeader('Location')).toBeUndefined();
    expect(setCookies(res)).toHaveLength(0);
  });
});
