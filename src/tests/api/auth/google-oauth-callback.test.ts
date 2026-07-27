import type { NextApiHandler } from 'next';

import '@jest/globals';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { createMocks } from 'node-mocks-http';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';
import { CSRF_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE } from '@/src/lib/cookies';

// The strategy's verify callback (profile → user / consent challenge) is covered in
// oauth-consent.test.ts. Here the strategy is stubbed so the ROUTE's own branching
// is what's under test: state check, consent redirect, failure mapping, session
// issuance. Every branch is a redirect, so a wrong one silently signs the wrong
// person in (or nobody) — that's what these lock down.
const authenticateMock = jest.fn();

jest.mock('@/src/lib/passport', () => ({
  __esModule: true,
  default: {
    authenticate: (...args: unknown[]) => authenticateMock(...args),
  },
}));

// Pinned before the route module is imported: it reads FRONTEND_URL at load time,
// and dotenv never overrides an already-set var, so a stray .env can't shift it.
const FRONTEND = 'http://localhost:3033';
process.env.FRONTEND_URL = FRONTEND;

const STATE_COOKIE = 'oauth_state_google';
const STATE = 'state-from-the-start-route';

let callbackHandler: NextApiHandler;

beforeAll(async () => {
  ({ default: callbackHandler } = await import('@/src/pages/api/auth/google/callback'));
});

beforeEach(async () => {
  authenticateMock.mockReset();
  await User.deleteMany({});
});

type MockRes = ReturnType<typeof createMocks>['res'];
type PassportCallback = (error: Error | null, user: unknown, info?: unknown) => void;

function setCookies(res: MockRes): string[] {
  const raw = res.getHeader('Set-Cookie');
  return Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
}

/** Make the stubbed strategy answer with a fixed (error, user, info) triple. */
function stubStrategy(result: { error?: Error; user?: unknown; info?: unknown }) {
  authenticateMock.mockImplementation(
    (_strategy: string, _options: unknown, callback: PassportCallback) => () =>
      callback(result.error ?? null, result.user ?? false, result.info)
  );
}

/** A callback request carrying a state that matches the pinned cookie. */
function callbackRequest(overrides: { state?: string; cookieState?: string | null } = {}) {
  const { state = STATE, cookieState = STATE } = overrides;
  return createMocks({
    method: HTTP_METHOD.GET,
    url: '/api/auth/google/callback',
    query: { code: 'google-auth-code', ...(state === undefined ? {} : { state }) },
    headers: cookieState === null ? {} : { cookie: `${STATE_COOKIE}=${cookieState}` },
  });
}

async function createConsentedUser() {
  return User.create({
    name: 'Google User',
    email: 'google-user@example.com',
    googleId: 'google-user-id',
    isEmailVerified: true,
    personalDataConsentAt: new Date(),
    personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION,
  });
}

describe('GET /api/auth/google/callback', () => {
  it('issues a session and redirects to the frontend success page', async () => {
    const user = await createConsentedUser();
    stubStrategy({ user });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/success`);
    // No token in the URL — the session rides in cookies only.
    expect(res._getRedirectUrl()).not.toContain('token');

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
    const rows = await dbQuery('SELECT user_id, token_hash FROM refresh_tokens');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].user_id).toBe(user.id);

    // The strategy must run session-less: passport sessions are not this app's
    // transport, its own cookies are.
    expect(authenticateMock).toHaveBeenCalledWith(
      'google',
      expect.objectContaining({ session: false }),
      expect.any(Function)
    );
  });

  it('rejects a state that does not match the cookie, without touching the strategy', async () => {
    stubStrategy({ user: await createConsentedUser() });
    const { req, res } = callbackRequest({ state: 'forged-state' });

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=google_state`);
    // The forged request never reaches Google's token exchange…
    expect(authenticateMock).not.toHaveBeenCalled();
    // …and no session is issued.
    expect(setCookies(res).some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(false);
    const rows = await dbQuery('SELECT id FROM refresh_tokens');
    expect(rows.rows).toHaveLength(0);
  });

  it('rejects a callback with no state cookie at all', async () => {
    stubStrategy({ user: await createConsentedUser() });
    const { req, res } = callbackRequest({ cookieState: null });

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=google_state`);
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it('clears the state cookie once it has been used', async () => {
    stubStrategy({ user: await createConsentedUser() });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    const stateCookie = setCookies(res).find((c) => c.startsWith(`${STATE_COOKIE}=`));
    expect(stateCookie).toContain('Max-Age=0');
  });

  it('sends a user who needs consent to the consent screen with the challenge token', async () => {
    stubStrategy({ user: false, info: { consentToken: 'consent token/with+chars' } });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(
      `${FRONTEND}/auth/oauth-consent#token=${encodeURIComponent('consent token/with+chars')}`
    );
    // Not signed in yet — the session comes only after consent is recorded.
    expect(setCookies(res).some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(false);
  });

  it('maps a missing OAuth account to the account_not_found error', async () => {
    stubStrategy({ user: false, info: { message: 'oauth_account_not_found' } });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=account_not_found`);
  });

  it('falls back to the generic error when the strategy fails without info', async () => {
    stubStrategy({ user: false });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=google_failed`);
  });

  it('redirects to the generic error when the strategy errors out', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    stubStrategy({ error: new Error('token exchange exploded') });
    const { req, res } = callbackRequest();

    await callbackHandler(req, res);

    expect(res._getRedirectUrl()).toBe(`${FRONTEND}/auth/jwt/sign-in?oauthError=google_failed`);
    expect(setCookies(res).some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(false);
    // Logged for triage, but the message only — no codes/tokens/profile.
    expect(consoleError).toHaveBeenCalledWith(
      '[oauth.google.callback] authentication failed',
      'token exchange exploded'
    );
    consoleError.mockRestore();
  });

  it('does not accept a non-GET callback', async () => {
    stubStrategy({ user: await createConsentedUser() });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      url: '/api/auth/google/callback',
      query: { code: 'google-auth-code', state: STATE },
      headers: { cookie: `${STATE_COOKIE}=${STATE}` },
    });

    await callbackHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
    expect(authenticateMock).not.toHaveBeenCalled();
    expect(setCookies(res).some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(false);
  });
});
