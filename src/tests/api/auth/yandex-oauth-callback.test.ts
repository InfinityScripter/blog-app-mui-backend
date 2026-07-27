import type { NextApiHandler } from 'next';

import '@jest/globals';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { createMocks } from 'node-mocks-http';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';
import { CSRF_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE } from '@/src/lib/cookies';

// Yandex itself is stubbed at the fetch boundary, so what's under test is the
// ROUTE's own branching: state check, error mapping, consent redirect, session
// issuance. Every branch is a redirect, so a wrong one silently signs the wrong
// person in (or nobody) — that's what these lock down.
//
// Pinned before the route module is imported: it captures the OAuth creds and
// the redirect URI at load time, and dotenv never overrides an already-set var,
// so a stray .env can't shift them.
const FRONTEND = 'http://localhost:3033';
process.env.FRONTEND_URL = FRONTEND;
process.env.YANDEX_CLIENT_ID = 'test-yandex-client';
process.env.YANDEX_CLIENT_SECRET = 'test-yandex-secret';
process.env.BACKEND_URL = 'http://localhost:7272';

const TOKEN_URL = 'https://oauth.yandex.com/token';
const USERINFO_URL = 'https://login.yandex.ru/info?format=json';

const STATE_COOKIE = 'oauth_state_yandex';
const STATE = 'state-from-the-start-route-1234567890abc';

const PROFILE = {
  id: 'yandex-user-id',
  real_name: 'Пользователь Яндекса',
  // Mixed case on purpose: the account below is stored lowercased, so this also
  // pins that the callback canonicalises the address before looking it up.
  default_email: 'Yandex.User@Example.COM',
  default_avatar_id: 'avatar-42',
};
const EMAIL = 'yandex.user@example.com';

let callbackHandler: NextApiHandler;

beforeAll(async () => {
  ({ default: callbackHandler } = await import('@/src/pages/api/auth/yandex/callback'));
});

type MockRes = ReturnType<typeof createMocks>['res'];

interface StubbedCall {
  ok?: boolean;
  body?: unknown;
  /** Make .json() reject — stands in for a malformed or truncated response. */
  throws?: boolean;
}

let fetchedUrls: string[] = [];

/** Answer the token and userinfo calls; both default to a successful sign-in. */
function stubYandex(token: StubbedCall = {}, userinfo: StubbedCall = {}) {
  fetchedUrls = [];
  global.fetch = jest.fn(async (url: string) => {
    const target = String(url);
    fetchedUrls.push(target);
    const stub = target.startsWith(TOKEN_URL)
      ? { ok: true, body: { access_token: 'yandex-access-token' }, ...token }
      : { ok: true, body: PROFILE, ...userinfo };
    return {
      ok: stub.ok,
      status: stub.ok ? 200 : 502,
      json: async () => {
        if (stub.throws) {
          throw new Error('malformed yandex response');
        }
        return stub.body;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function setCookies(res: MockRes): string[] {
  const raw = res.getHeader('Set-Cookie');
  return Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
}

function stateCookieAttrs(res: MockRes): string[] {
  const cleared = setCookies(res).find((cookie) => cookie.startsWith(`${STATE_COOKIE}=`));
  expect(cleared).toBeDefined();
  return cleared!
    .split(';')
    .slice(1)
    .map((part) => part.trim());
}

function hasCookie(res: MockRes, name: string): boolean {
  return setCookies(res).some((cookie) => cookie.startsWith(`${name}=`));
}

interface RequestOverrides {
  query?: Record<string, string | undefined>;
  cookieState?: string | null;
  headers?: Record<string, string>;
  method?: string;
}

/** A callback request carrying a state that matches the pinned cookie. */
function callbackRequest({
  query = {},
  cookieState = STATE,
  headers = {},
  method = HTTP_METHOD.GET,
}: RequestOverrides = {}) {
  return createMocks({
    method,
    url: '/api/auth/yandex/callback',
    query: { code: 'yandex-auth-code', state: STATE, ...query },
    headers:
      cookieState === null ? headers : { cookie: `${STATE_COOKIE}=${cookieState}`, ...headers },
  });
}

async function createConsentedUser() {
  return User.create({
    name: 'Yandex User',
    email: EMAIL,
    isEmailVerified: true,
    personalDataConsentAt: new Date(),
    personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION,
  });
}

describe('GET /api/auth/yandex/callback', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('issues a session and redirects to the frontend success page', async () => {
    const user = await createConsentedUser();
    stubYandex();
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/success`);
    // No token in the URL — the session rides in cookies only.
    expect(res._getRedirectUrl()).not.toContain('token');
    expect(fetchedUrls).toEqual([TOKEN_URL, USERINFO_URL]);

    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith(`${ACCESS_COOKIE}=`) && c.includes('HttpOnly'))).toBe(
      true
    );
    expect(cookies.some((c) => c.startsWith(`${REFRESH_COOKIE}=`) && c.includes('HttpOnly'))).toBe(
      true
    );
    // CSRF cookie is readable by JS on purpose (double-submit).
    expect(cookies.some((c) => c.startsWith(`${CSRF_COOKIE}=`) && !c.includes('HttpOnly'))).toBe(
      true
    );

    // The refresh row is persisted against this user (hashed, never the raw value).
    const rows = await dbQuery('SELECT user_id FROM refresh_tokens');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].user_id).toBe(user.id);

    // …and the Yandex account is now linked to it.
    const linked = await User.findOne({ email: EMAIL });
    expect(linked?.yandexId).toBe(PROFILE.id);
    expect(linked?.avatarURL).toBe(
      `https://avatars.yandex.net/get-yapic/${PROFILE.default_avatar_id}/islands-200`
    );
  });

  it.each([
    ['a different length', 'forged'],
    ['the same length', `${STATE.slice(0, -1)}X`],
  ])('rejects a state forged with %s, without touching Yandex', async (_label, forgedState) => {
    await createConsentedUser();
    stubYandex();
    const { req, res } = callbackRequest({ query: { state: forgedState } });

    await callbackHandler(req, res);

    // A differing length is the input crypto.timingSafeEqual throws on, and an
    // equal length is the one a length-only check would wave through — the
    // constant-time compare has to reject both, and neither may 500.
    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=yandex_state`);
    // The forged request never reaches Yandex's token exchange…
    expect(fetchedUrls).toHaveLength(0);
    // …and no session is issued.
    expect(hasCookie(res, ACCESS_COOKIE)).toBe(false);
    const rows = await dbQuery('SELECT id FROM refresh_tokens');
    expect(rows.rows).toHaveLength(0);
  });

  it('rejects a callback with no state cookie at all', async () => {
    await createConsentedUser();
    stubYandex();
    const { req, res } = callbackRequest({ cookieState: null });

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=yandex_state`);
    expect(fetchedUrls).toHaveLength(0);
  });

  it('clears the state cookie with the attributes it was set with', async () => {
    await createConsentedUser();
    stubYandex();
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    // Same attributes as the start route pinned it with: a clearing cookie that
    // drops HttpOnly/SameSite is a different cookie, so the browser keeps the
    // original one alive and the state stays replayable.
    expect(stateCookieAttrs(res)).toEqual([
      'Max-Age=0',
      'Path=/api/auth/yandex/callback',
      'HttpOnly',
      'SameSite=Lax',
    ]);
  });

  it('clears the state cookie Secure when the request arrived over https', async () => {
    await createConsentedUser();
    stubYandex();
    // nginx terminates TLS in front of `next start`, so the proxy header is the
    // only signal that the browser leg was https.
    const { req, res } = callbackRequest({ headers: { 'x-forwarded-proto': 'https' } });

    await callbackHandler(req, res);

    expect(stateCookieAttrs(res)).toContain('Secure');
  });

  it('sends a user who needs consent to the consent screen with the challenge token', async () => {
    stubYandex();
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toMatch(
      new RegExp(`^${FRONTEND}/auth/oauth-consent#token=[\\w.~-]+$`)
    );
    // Not signed in yet — the session comes only after consent is recorded.
    expect(hasCookie(res, ACCESS_COOKIE)).toBe(false);
  });

  it('maps a denied consent screen to the denied error', async () => {
    stubYandex();
    const { req, res } = callbackRequest({ query: { error: 'access_denied' } });

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=yandex_denied`);
    expect(fetchedUrls).toHaveLength(0);
  });

  it('maps a callback without an authorization code to the no_code error', async () => {
    stubYandex();
    const { req, res } = callbackRequest({ query: { code: undefined } });

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=yandex_no_code`);
    expect(fetchedUrls).toHaveLength(0);
  });

  it('maps a rejected token exchange to the token error', async () => {
    await createConsentedUser();
    stubYandex({ ok: false });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=yandex_token`);
    // The profile is never requested with a token exchange that failed.
    expect(fetchedUrls).toEqual([TOKEN_URL]);
  });

  it('maps a token response with no access_token to the token error', async () => {
    await createConsentedUser();
    stubYandex({ body: {} });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=yandex_token`);
    expect(fetchedUrls).toEqual([TOKEN_URL]);
  });

  it('maps a rejected profile request to the userinfo error', async () => {
    await createConsentedUser();
    stubYandex({}, { ok: false });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=yandex_userinfo`);
    expect(hasCookie(res, ACCESS_COOKIE)).toBe(false);
  });

  it('maps a profile with no email to the email error', async () => {
    await createConsentedUser();
    stubYandex({}, { body: { id: PROFILE.id } });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=yandex_email`);
    expect(hasCookie(res, ACCESS_COOKIE)).toBe(false);
  });

  it('redirects to the generic error when the exchange blows up', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    await createConsentedUser();
    stubYandex({ throws: true });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=yandex_unknown`);
    expect(hasCookie(res, ACCESS_COOKIE)).toBe(false);
    // Logged for triage, but the message only — no codes/tokens/profile.
    expect(consoleError).toHaveBeenCalledWith(
      '[oauth.yandex.callback] authentication failed',
      'malformed yandex response'
    );
  });

  it('does not accept a non-GET callback', async () => {
    await createConsentedUser();
    stubYandex();
    const { req, res } = callbackRequest({ method: HTTP_METHOD.POST });

    await callbackHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
    expect(fetchedUrls).toHaveLength(0);
    expect(hasCookie(res, ACCESS_COOKIE)).toBe(false);
  });
});
