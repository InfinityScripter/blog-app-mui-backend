import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/auth/me';

jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key';

describe('GET /api/auth/me', () => {
  let userId: string;

  beforeEach(async () => {
    await User.deleteMany({});
    const user = await User.create({
      name: 'Me User',
      email: 'me@example.com',
      passwordHash: 'x',
      isEmailVerified: true,
    });
    userId = user._id;
  });

  it('returns the current user for a valid token', async () => {
    const token = jwt.sign({ userId, role: 'user' }, JWT_SECRET);
    const { req, res } = createMocks({
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.user.email).toBe('me@example.com');
  });

  it('returns 401 (not 500) for an invalid token', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: { authorization: 'Bearer garbage.token.here' },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 401 when no token is provided', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(401);
  });
});
