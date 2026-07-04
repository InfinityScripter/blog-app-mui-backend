import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import statusHandler from '@/src/pages/api/admin/bot/status';

function makeToken(userId: string, role: string) {
  return `Bearer ${jwt.sign({ userId, role }, JWT_SECRET)}`;
}

describe('GET /api/admin/bot/status auth gating', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    const hash = await import('bcrypt').then((b) => b.hash('pass', 10));
    await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'admin',
    });
    await User.create({
      name: 'User',
      email: 'user@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'user',
    });
  });

  it('401 without a JWT', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET });
    await statusHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('403 for a non-admin JWT', async () => {
    const user = await User.findOne({ email: 'user@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(user!._id, 'user') },
    });
    await statusHandler(req, res);
    expect(res._getStatusCode()).toBe(403);
  });

  it('requireAdmin runs before any bot call: a non-admin gets 403 even with a dead bot URL', async () => {
    // Point at a closed port. If requireAdmin did NOT run first, the handler
    // would try to fetch the bot and the test would hang/behave differently.
    const prev = process.env.BOT_CONTROL_URL;
    process.env.BOT_CONTROL_URL = 'http://127.0.0.1:1';
    try {
      const user = await User.findOne({ email: 'user@test.com' });
      const { req, res } = createMocks({
        method: HTTP_METHOD.GET,
        headers: { authorization: makeToken(user!._id, 'user') },
      });
      await statusHandler(req, res);
      expect(res._getStatusCode()).toBe(403);
    } finally {
      process.env.BOT_CONTROL_URL = prev;
    }
  });

  it('405 for a non-GET method (admin)', async () => {
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await statusHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });
});
