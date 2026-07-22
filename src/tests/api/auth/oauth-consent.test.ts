import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import consentHandler from '@/src/pages/api/auth/oauth/consent';
import { __resetRateLimitStore } from '@/src/middlewares/rate-limit';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';
import {
  createOAuthConsentChallenge,
  completeOAuthConsentChallenge,
  finalizeOAuthConsentChallenge,
} from '@/src/services/oauth-consent';

const consentBody = (token: string) => ({
  token,
  personalDataConsent: true,
  personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION,
});

beforeEach(async () => {
  __resetRateLimitStore();
  await User.deleteMany({});
});

describe('POST /api/auth/oauth/consent', () => {
  it('records current consent for a legacy OAuth-only user and issues cookies', async () => {
    await User.create({
      name: 'Legacy Google User',
      email: 'legacy@example.com',
      googleId: 'google-legacy',
      isEmailVerified: true,
    });
    const token = await createOAuthConsentChallenge({
      provider: 'google',
      providerUserId: 'google-legacy',
      email: 'legacy@example.com',
      name: 'Legacy Google User',
    });
    const { req, res } = createMocks({ method: HTTP_METHOD.POST, body: consentBody(token) });

    await consentHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res.getHeader('Set-Cookie')).toBeDefined();
    const user = await User.findOne({ email: 'legacy@example.com' });
    expect(user?.personalDataConsentAt).toBeInstanceOf(Date);
    expect(user?.personalDataConsentVersion).toBe(PERSONAL_DATA_CONSENT_VERSION);
  });

  it('creates a new OAuth-only user only after explicit consent', async () => {
    const token = await createOAuthConsentChallenge({
      provider: 'yandex',
      providerUserId: 'yandex-new',
      email: 'new@example.com',
      name: 'New User',
      avatarURL: 'https://example.com/avatar.png',
    });
    const { req, res } = createMocks({ method: HTTP_METHOD.POST, body: consentBody(token) });

    await consentHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const user = await User.findOne({ email: 'new@example.com' });
    expect(user?.yandexId).toBe('yandex-new');
    expect(user?.passwordHash).toBeNull();
    expect(user?.personalDataConsentVersion).toBe(PERSONAL_DATA_CONSENT_VERSION);
  });

  it('consumes the challenge exactly once', async () => {
    const token = await createOAuthConsentChallenge({
      provider: 'google',
      providerUserId: 'google-once',
      email: 'once@example.com',
      name: 'Once',
    });
    const first = createMocks({ method: HTTP_METHOD.POST, body: consentBody(token) });
    await consentHandler(first.req, first.res);
    expect(first.res._getStatusCode()).toBe(200);

    const second = createMocks({ method: HTTP_METHOD.POST, body: consentBody(token) });
    await consentHandler(second.req, second.res);
    expect(second.res._getStatusCode()).toBe(410);
  });

  it('removes attacker-known credentials from an unverified pre-registered email', async () => {
    await User.create({
      name: 'Unverified',
      email: 'victim@example.com',
      passwordHash: await bcrypt.hash('attacker-password', 10),
      isEmailVerified: false,
      emailVerificationCode: '123456',
      passwordResetCode: '654321',
    });
    const token = await createOAuthConsentChallenge({
      provider: 'google',
      providerUserId: 'victim-google',
      email: 'victim@example.com',
      name: 'Verified Victim',
    });
    const { req, res } = createMocks({ method: HTTP_METHOD.POST, body: consentBody(token) });

    await consentHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const user = await User.findOne({ email: 'victim@example.com' });
    expect(user?.googleId).toBe('victim-google');
    expect(user?.isEmailVerified).toBe(true);
    expect(user?.passwordHash).toBeNull();
    expect(user?.emailVerificationCode).toBeNull();
    expect(user?.passwordResetCode).toBeNull();
  });

  it('routes a current-consent but unverified Google account through the clearing flow', async () => {
    await User.create({
      name: 'Pre-registered',
      email: 'google-victim@example.com',
      passwordHash: await bcrypt.hash('attacker-password', 10),
      isEmailVerified: false,
      personalDataConsentAt: new Date(),
      personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION,
    });

    process.env.GOOGLE_CLIENT_ID = 'test-google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    const { default: configuredPassport } = await import('@/src/lib/passport');
    const strategy = (configuredPassport as any)._strategy('google');
    const result = await new Promise<{ user: unknown; info?: { consentToken?: string } }>(
      (resolve, reject) => {
        strategy._verify(
          '',
          '',
          {
            id: 'google-victim-id',
            displayName: 'Verified Victim',
            emails: [{ value: 'google-victim@example.com' }],
            photos: [],
          },
          (error: Error | null, user: unknown, info?: { consentToken?: string }) => {
            if (error) reject(error);
            else resolve({ user, info });
          }
        );
      }
    );

    expect(result.user).toBe(false);
    expect(result.info?.consentToken).toEqual(expect.any(String));

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: consentBody(result.info!.consentToken!),
    });
    await consentHandler(req, res);
    expect(res._getStatusCode()).toBe(200);

    const user = await User.findOne({ email: 'google-victim@example.com' });
    expect(user?.isEmailVerified).toBe(true);
    expect(user?.googleId).toBe('google-victim-id');
    expect(user?.passwordHash).toBeNull();
  });

  it('allows retry after a transient completion claim expires', async () => {
    const token = await createOAuthConsentChallenge({
      provider: 'google',
      providerUserId: 'google-retry',
      email: 'retry@example.com',
      name: 'Retry User',
    });

    await completeOAuthConsentChallenge(token);
    await expect(completeOAuthConsentChallenge(token)).rejects.toMatchObject({ status: 409 });

    await dbQuery(
      'UPDATE oauth_consent_challenges SET claim_expires_at = $1 WHERE claim_id IS NOT NULL',
      [new Date(Date.now() - 1_000).toISOString()]
    );
    const retried = await completeOAuthConsentChallenge(token);
    await finalizeOAuthConsentChallenge(token, retried.claimId);

    expect(retried.user.email).toBe('retry@example.com');
  });
});
