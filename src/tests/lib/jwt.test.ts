import '@jest/globals';

describe('lib/jwt', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('signs and verifies a token round-trip with the configured secret', async () => {
    process.env.JWT_SECRET = 'unit_test_secret';
    process.env.NODE_ENV = 'test';
    const { signToken, verifyToken } = await import('@/src/lib/jwt');

    const token = signToken({ userId: 'u1', role: 'admin' });
    const decoded = verifyToken(token);

    expect(decoded.userId).toBe('u1');
    expect(decoded.role).toBe('admin');
  });

  it('throws on an invalid token', async () => {
    process.env.JWT_SECRET = 'unit_test_secret';
    process.env.NODE_ENV = 'test';
    const { verifyToken } = await import('@/src/lib/jwt');

    expect(() => verifyToken('not-a-real-token')).toThrow();
  });

  it('throws at import time in production when JWT_SECRET is unset (no weak default)', async () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';

    await expect(import('@/src/lib/jwt')).rejects.toThrow(/JWT_SECRET/);
  });

  it('does NOT fall back to the legacy hardcoded "secret123"', async () => {
    process.env.JWT_SECRET = 'unit_test_secret';
    process.env.NODE_ENV = 'test';
    const { JWT_SECRET } = await import('@/src/lib/jwt');

    expect(JWT_SECRET).toBe('unit_test_secret');
    expect(JWT_SECRET).not.toBe('secret123');
  });
});
