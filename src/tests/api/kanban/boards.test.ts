import '@jest/globals';

import jwt from 'jsonwebtoken';
import { createMocks } from 'node-mocks-http';

import User from '@/src/models/User';
import handler from '@/src/pages/api/kanban/boards';
import { JWT_SECRET } from '@/src/lib/jwt';

jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));


function makeToken(userId: string, role = 'user') {
  return `Bearer ${jwt.sign({ userId, role }, JWT_SECRET)}`;
}

describe('Kanban boards API', () => {
  let adminId: string;
  let userId: string;

  beforeEach(async () => {
    await User.deleteMany({});
    const { hash } = await import('bcrypt').then((b) => ({ hash: b.hash('pass', 10) }));
    const h = await hash;
    const admin = await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      passwordHash: h,
      isEmailVerified: true,
      role: 'admin',
    });
    const user = await User.create({
      name: 'User',
      email: 'user@test.com',
      passwordHash: h,
      isEmailVerified: true,
      role: 'user',
    });
    adminId = admin._id;
    userId = user._id;
  });

  it('should create a board as admin', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: makeToken(adminId, 'admin') },
      body: { name: 'Sprint 1' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(201);
    const data = JSON.parse(res._getData());
    expect(data.board.id).toBeDefined();
    expect(data.board.name).toBe('Sprint 1');
  });

  it('should return 403 for non-admin creating board', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: makeToken(userId, 'user') },
      body: { name: 'Board' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(403);
  });

  it('should list boards for member', async () => {
    // Create board first as admin
    const { req: cr, res: cres } = createMocks({
      method: 'POST',
      headers: { authorization: makeToken(adminId, 'admin') },
      body: { name: 'Sprint 1', memberIds: [userId] },
    });
    await handler(cr, cres);

    // Admin should see it
    const { req, res } = createMocks({
      method: 'GET',
      headers: { authorization: makeToken(adminId, 'admin') },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.boards).toHaveLength(1);
  });
});
