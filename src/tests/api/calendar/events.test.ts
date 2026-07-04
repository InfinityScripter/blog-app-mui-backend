import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import handler from '@/src/pages/api/calendar/events';

const makeToken = (userId: string) => `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET)}`;

describe('Calendar events API', () => {
  let userId: string;

  beforeEach(async () => {
    await User.deleteMany({});
    const { hash } = await import('bcrypt').then((b) => ({ hash: b.hash('pass', 10) }));
    const h = await hash;
    const u = await User.create({
      name: 'U',
      email: 'u@test.com',
      passwordHash: h,
      isEmailVerified: true,
    });
    userId = u._id;
  });

  it('should create a personal event', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(userId) },
      body: {
        title: 'Test',
        start: new Date().toISOString(),
        end: new Date().toISOString(),
        type: 'personal',
      },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(201);
    const data = JSON.parse(res._getData());
    expect(data.event.title).toBe('Test');
  });

  it('should list personal + public events', async () => {
    const { req: cr, res: cres } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(userId) },
      body: {
        title: 'Mine',
        start: new Date().toISOString(),
        end: new Date().toISOString(),
        type: 'personal',
      },
    });
    await handler(cr, cres);

    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(userId) },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.events.length).toBeGreaterThanOrEqual(1);
  });

  it('should return 400 when required fields missing', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(userId) },
      body: { title: 'No dates' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });
});
