import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/admin/users';
import { HTTP_METHOD } from '@/src/constants/http';

function makeToken(userId: string, role: string) {
  return `Bearer ${jwt.sign({ userId, role }, JWT_SECRET)}`;
}

describe('GET /api/admin/users', () => {
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

  it('should return all users for admin', async () => {
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.users).toHaveLength(2);
  });

  it('should return 403 for non-admin', async () => {
    const user = await User.findOne({ email: 'user@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(user!._id, 'user') },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(403);
  });
});
