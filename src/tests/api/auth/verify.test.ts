import '@jest/globals';
import User from '@/src/models/User';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/auth/verify';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

const CODE = '123456';

async function createUnverifiedUser(overrides: Record<string, unknown> = {}) {
  return User.create({
    name: 'Verify User',
    email: 'verify@example.com',
    passwordHash: 'x',
    isEmailVerified: false,
    emailVerificationCode: CODE,
    emailVerificationExpires: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  });
}

function post(body: Record<string, unknown>) {
  return createMocks({ method: HTTP_METHOD.POST, body });
}

describe('POST /api/auth/verify', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  it('verifies the email with a valid code', async () => {
    await createUnverifiedUser();
    const { req, res } = post({ email: 'verify@example.com', code: CODE });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.OK);
    expect(JSON.parse(res._getData()).success).toBe(true);

    const user = await User.findOne({ email: 'verify@example.com' });
    expect(user?.isEmailVerified).toBe(true);
    expect(user?.emailVerificationCode ?? null).toBeNull();
  });

  it('matches the email case-insensitively', async () => {
    await createUnverifiedUser();
    const { req, res } = post({ email: '  VERIFY@example.com ', code: CODE });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.OK);
  });

  it('rejects a wrong code', async () => {
    await createUnverifiedUser();
    const { req, res } = post({ email: 'verify@example.com', code: '000000' });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
    expect(JSON.parse(res._getData()).message).toBe('Invalid verification code');
  });

  it('rejects an expired code', async () => {
    await createUnverifiedUser({
      emailVerificationExpires: new Date(Date.now() - 60 * 1000),
    });
    const { req, res } = post({ email: 'verify@example.com', code: CODE });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
    expect(JSON.parse(res._getData()).message).toBe('Verification code has expired');
  });

  it('rejects an already verified user', async () => {
    await createUnverifiedUser({ isEmailVerified: true });
    const { req, res } = post({ email: 'verify@example.com', code: CODE });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
    expect(JSON.parse(res._getData()).message).toBe('Email is already verified');
  });

  it('rejects an unknown email', async () => {
    const { req, res } = post({ email: 'nobody@example.com', code: CODE });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
  });

  it('requires email and code', async () => {
    const { req, res } = post({ email: 'verify@example.com' });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
  });

  it('returns 405 for non-POST methods', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
  });
});
