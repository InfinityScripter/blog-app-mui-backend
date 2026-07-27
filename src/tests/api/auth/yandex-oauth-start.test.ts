import type { NextApiHandler } from 'next';

import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// The route captures the client id and the redirect URI at module load, so the
// env has to be pinned before the dynamic import below. BACKEND_URL is pinned
// too, so the redirect_uri baked into the authorize URL is the same on any
// machine (and can't be shifted by a stray .env).
const CLIENT_ID = 'test-yandex-client';
process.env.YANDEX_CLIENT_ID = CLIENT_ID;
process.env.BACKEND_URL = 'http://localhost:7272';

const STATE_COOKIE = 'oauth_state_yandex';

let startHandler: NextApiHandler;

beforeAll(async () => {
  ({ default: startHandler } = await import('@/src/pages/api/auth/yandex'));
});

type MockRes = ReturnType<typeof createMocks>['res'];

function setCookies(res: MockRes): string[] {
  const raw = res.getHeader('Set-Cookie');
  return Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
}

function stateCookie(res: MockRes): string {
  const cookie = setCookies(res).find((part) => part.startsWith(`${STATE_COOKIE}=`));
  expect(cookie).toBeDefined();
  return cookie!;
}

/** The cookie's value, i.e. the state itself. */
function stateValue(res: MockRes): string {
  return stateCookie(res)
    .split(';')[0]
    .slice(STATE_COOKIE.length + 1);
}

/** The cookie's attributes, exactly as sent — so `Secure` can be asserted absent. */
function stateAttrs(res: MockRes): string[] {
  return stateCookie(res)
    .split(';')
    .slice(1)
    .map((part) => part.trim());
}

async function startFlow(headers: Record<string, string> = {}) {
  const { req, res } = createMocks({ method: HTTP_METHOD.GET, url: '/api/auth/yandex', headers });
  await startHandler(req, res);
  return res;
}

describe('GET /api/auth/yandex (OAuth start)', () => {
  it('redirects to Yandex with the state it just pinned in the cookie', async () => {
    const res = await startFlow();

    expect(res._getStatusCode()).toBe(302);
    const location = res._getRedirectUrl();
    expect(location.startsWith('https://oauth.yandex.com/authorize')).toBe(true);

    const params = new URL(location).searchParams;
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('redirect_uri')).toBe('http://localhost:7272/api/auth/yandex/callback');
    expect(params.get('response_type')).toBe('code');

    // The whole CSRF guarantee of the flow: the state Yandex will echo back to
    // the callback must be the one pinned in the cookie on THIS response.
    expect(params.get('state')).toBe(stateValue(res));
  });

  it('pins the state in a cookie the callback can validate and the page cannot read', async () => {
    const res = await startFlow();

    expect(stateAttrs(res)).toEqual([
      'Max-Age=600',
      'Path=/api/auth/yandex/callback',
      'HttpOnly',
      'SameSite=Lax',
    ]);
  });

  it('mints the state from 32 bytes of entropy, freshly per request', async () => {
    const first = stateValue(await startFlow());
    const second = stateValue(await startFlow());

    // base64url of 32 random bytes — 43 unpadded chars. Guards the entropy from
    // silently shrinking back to the 16 bytes this route used to mint.
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it('marks the state cookie Secure when the request arrived over https', async () => {
    // nginx terminates TLS in front of `next start`, so the proxy header is the
    // only signal that the browser leg was https.
    const res = await startFlow({ 'x-forwarded-proto': 'https' });

    expect(stateAttrs(res)).toContain('Secure');
  });

  it('leaves the state cookie non-Secure on plain http, so dev browsers keep it', async () => {
    const res = await startFlow();

    expect(stateAttrs(res)).not.toContain('Secure');
  });

  it('does not start a flow for a non-GET method', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.POST, url: '/api/auth/yandex' });

    await startHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
    // No redirect to Yandex and no state pinned — nothing was set in motion.
    expect(res._getRedirectUrl()).toBe('');
    expect(setCookies(res)).toHaveLength(0);
  });

  it('does not start a flow when the Yandex credentials are missing', async () => {
    // The client id is read at module load, so an unconfigured route means a
    // separate module instance. The pg-mem pool is cached on globalThis, so the
    // reset does not build a second database.
    jest.resetModules();
    delete process.env.YANDEX_CLIENT_ID;
    let unconfiguredHandler: NextApiHandler;
    try {
      ({ default: unconfiguredHandler } = await import('@/src/pages/api/auth/yandex'));
    } finally {
      process.env.YANDEX_CLIENT_ID = CLIENT_ID;
    }
    const { req, res } = createMocks({ method: HTTP_METHOD.GET, url: '/api/auth/yandex' });

    await unconfiguredHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.INTERNAL);
    expect(res._getRedirectUrl()).toBe('');
    expect(setCookies(res)).toHaveLength(0);
  });
});
