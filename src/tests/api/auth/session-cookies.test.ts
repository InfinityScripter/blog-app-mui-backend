import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import RefreshToken from '@/src/models/RefreshToken';
import { rotateRefresh } from '@/src/services/refresh';
import signInHandler from '@/src/pages/api/auth/sign-in';
import refreshHandler from '@/src/pages/api/auth/refresh';
import signOutHandler from '@/src/pages/api/auth/sign-out';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';
import { CSRF_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE } from '@/src/lib/cookies';

// ----------------------------------------------------------------------
// Helpers to read cookies off a node-mocks-http response and re-present them on
// the next request, so we can drive the full login → refresh → sign-out flow.

type MockRes = ReturnType<typeof createMocks>['res'];

function setCookies(res: MockRes): string[] {
  const raw = res.getHeader('Set-Cookie');
  return Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
}

/** Parse `name=value` from a Set-Cookie string (ignoring attributes). */
function cookieValue(setCookieStrings: string[], name: string): string | undefined {
  const match = setCookieStrings.find((c) => c.startsWith(`${name}=`));
  if (!match) return undefined;
  const pair = match.split(';')[0];
  return pair.slice(name.length + 1);
}

/** Build a Cookie request header from a name→value map. */
function cookieHeader(map: Record<string, string | undefined>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

const EMAIL = 'session@example.com';
const PASSWORD = 'password123';

async function signIn() {
  const { req, res } = createMocks({
    method: HTTP_METHOD.POST,
    body: { email: EMAIL, password: PASSWORD },
  });
  await signInHandler(req, res);
  const cookies = setCookies(res);
  return {
    status: res._getStatusCode(),
    body: JSON.parse(res._getData()),
    access: cookieValue(cookies, ACCESS_COOKIE),
    refresh: cookieValue(cookies, REFRESH_COOKIE),
    csrf: cookieValue(cookies, CSRF_COOKIE),
  };
}

describe('auth session cookies + refresh rotation', () => {
  beforeEach(async () => {
    await dbQuery('DELETE FROM refresh_tokens');
    await User.deleteMany({});
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await User.create({
      name: 'Session User',
      email: EMAIL,
      passwordHash,
      isEmailVerified: true,
      personalDataConsentAt: new Date(),
      personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION,
    });
  });

  it('sign-in sets access + refresh + csrf cookies and persists a hashed refresh row', async () => {
    const r = await signIn();
    expect(r.status).toBe(200);
    expect(r.access).toBeTruthy();
    expect(r.refresh).toBeTruthy();
    expect(r.csrf).toBeTruthy();

    // The refresh row exists and stores the HASH, not the raw cookie value.
    const found = await RefreshToken.findByRawToken(r.refresh!);
    expect(found).not.toBeNull();
    const rows = await dbQuery('SELECT token_hash FROM refresh_tokens');
    expect(rows.rows[0].token_hash).not.toBe(r.refresh);
  });

  it('refresh rotates the token (old revoked, new issued) with a valid CSRF pair', async () => {
    const s = await signIn();

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        cookie: cookieHeader({ [REFRESH_COOKIE]: s.refresh, [CSRF_COOKIE]: s.csrf }),
        'x-csrf-token': s.csrf,
      },
    });
    await refreshHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const newRefresh = cookieValue(setCookies(res), REFRESH_COOKIE);
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(s.refresh);

    // Old refresh token is now revoked.
    const oldRow = await RefreshToken.findByRawToken(s.refresh!);
    expect(oldRow!.revokedAt).not.toBeNull();
    // New refresh token is live and in the same family (rotation lineage).
    const newRow = await RefreshToken.findByRawToken(newRefresh!);
    expect(newRow!.revokedAt).toBeNull();
    expect(newRow!.familyId).toBe(oldRow!.familyId);
  });

  it('refresh revokes the session when the stored consent is missing or outdated', async () => {
    const s = await signIn();
    const user = await User.findOne({ email: EMAIL });
    if (!user) throw new Error('test user missing');
    user.personalDataConsentAt = null;
    user.personalDataConsentVersion = null;
    await user.save();

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        cookie: cookieHeader({ [REFRESH_COOKIE]: s.refresh, [CSRF_COOKIE]: s.csrf }),
        'x-csrf-token': s.csrf,
      },
    });
    await refreshHandler(req, res);

    expect(res._getStatusCode()).toBe(428);
    const row = await RefreshToken.findByRawToken(s.refresh!);
    expect(row?.revokedAt).not.toBeNull();
    expect(setCookies(res).some((cookie) => cookie.includes('Max-Age=0'))).toBe(true);
  });

  it('refresh is rejected (403) without a CSRF header', async () => {
    const s = await signIn();
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { cookie: cookieHeader({ [REFRESH_COOKIE]: s.refresh, [CSRF_COOKIE]: s.csrf }) },
    });
    await refreshHandler(req, res);
    expect(res._getStatusCode()).toBe(403);
  });

  it('reusing an already-rotated refresh token revokes the whole family (theft response)', async () => {
    const s = await signIn();

    // First rotation — succeeds.
    const first = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        cookie: cookieHeader({ [REFRESH_COOKIE]: s.refresh, [CSRF_COOKIE]: s.csrf }),
        'x-csrf-token': s.csrf,
      },
    });
    await refreshHandler(first.req, first.res);
    const rotated = cookieValue(setCookies(first.res), REFRESH_COOKIE)!;
    const { familyId } = (await RefreshToken.findByRawToken(rotated))!;

    // Attacker replays the OLD (now revoked) token — theft detected.
    const replay = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        cookie: cookieHeader({ [REFRESH_COOKIE]: s.refresh, [CSRF_COOKIE]: s.csrf }),
        'x-csrf-token': s.csrf,
      },
    });
    await refreshHandler(replay.req, replay.res);
    expect(replay.res._getStatusCode()).toBe(401);

    // The whole family (including the legitimately-rotated token) is now dead.
    const rotatedRow = await RefreshToken.findByRawToken(rotated);
    expect(rotatedRow!.revokedAt).not.toBeNull();

    const live = await dbQuery(
      'SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL',
      [familyId]
    );
    expect(live.rows[0].n).toBe(0);
  });

  it('a forged refresh token is rejected (401) and clears cookies', async () => {
    const s = await signIn();
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        cookie: cookieHeader({ [REFRESH_COOKIE]: 'totally-made-up', [CSRF_COOKIE]: s.csrf }),
        'x-csrf-token': s.csrf,
      },
    });
    await refreshHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
    // Cookies cleared (Max-Age=0).
    const cleared = setCookies(res);
    expect(cleared.some((c) => c.startsWith(`${ACCESS_COOKIE}=`) && c.includes('Max-Age=0'))).toBe(
      true
    );
  });

  it('sign-out revokes the refresh family and clears cookies', async () => {
    const s = await signIn();
    const { familyId } = (await RefreshToken.findByRawToken(s.refresh!))!;

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        cookie: cookieHeader({ [REFRESH_COOKIE]: s.refresh, [CSRF_COOKIE]: s.csrf }),
        'x-csrf-token': s.csrf,
      },
    });
    await signOutHandler(req, res);
    expect(res._getStatusCode()).toBe(200);

    const live = await dbQuery(
      'SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL',
      [familyId]
    );
    expect(live.rows[0].n).toBe(0);
    const cleared = setCookies(res);
    expect(cleared.some((c) => c.includes('Max-Age=0'))).toBe(true);
  });

  it('concurrent reuse of the same token: exactly one rotation wins, no duplicate live session', async () => {
    const s = await signIn();
    const { familyId } = (await RefreshToken.findByRawToken(s.refresh!))!;

    // Fire two rotations with the SAME raw token at once (network retry / attacker
    // replay racing the legit client). The atomic consume() must let only one win.
    const results = await Promise.allSettled([
      rotateRefresh(s.refresh!, 'agent-a'),
      rotateRefresh(s.refresh!, 'agent-b'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // Exactly one succeeds; the loser is rejected (treated as reuse → 401).
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The original token is revoked, and there is at most ONE live successor in
    // the family — never two parallel live sessions from a single token.
    const live = await dbQuery(
      'SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL',
      [familyId]
    );
    expect(live.rows[0].n).toBeLessThanOrEqual(1);
    expect((await RefreshToken.findByRawToken(s.refresh!))!.revokedAt).not.toBeNull();
  });
});
