import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import handler from '@/src/pages/api/chat/channels';

function makeToken(userId: string) {
  return `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET)}`;
}

describe('Chat channels API', () => {
  let user1Id: string;
  let user2Id: string;

  beforeEach(async () => {
    await User.deleteMany({});
    const { hash } = await import('bcrypt').then((b) => ({
      hash: b.hash('pass', 10),
    }));
    const h = await hash;
    const u1 = await User.create({
      name: 'User1',
      email: 'u1@test.com',
      passwordHash: h,
      isEmailVerified: true,
    });
    const u2 = await User.create({
      name: 'User2',
      email: 'u2@test.com',
      passwordHash: h,
      isEmailVerified: true,
    });
    user1Id = u1._id;
    user2Id = u2._id;
  });

  it('should create a direct channel', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(user1Id) },
      body: { type: 'direct', memberIds: [user2Id] },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(201);
    const data = JSON.parse(res._getData());
    expect(data.channel.id).toBeDefined();
  });

  it('should return existing direct channel on duplicate create', async () => {
    const body = { type: 'direct', memberIds: [user2Id] };
    const { req: r1, res: res1 } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(user1Id) },
      body,
    });
    await handler(r1, res1);
    const id1 = JSON.parse(res1._getData()).channel.id;

    const { req: r2, res: res2 } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(user1Id) },
      body,
    });
    await handler(r2, res2);
    const id2 = JSON.parse(res2._getData()).channel.id;

    expect(id1).toBe(id2);
  });

  it('should list user channels', async () => {
    const { req: cr, res: cres } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(user1Id) },
      body: { type: 'direct', memberIds: [user2Id] },
    });
    await handler(cr, cres);

    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(user1Id) },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.channels).toHaveLength(1);
  });
});
