import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { requireAdmin } from '@/src/utils/admin';

jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));

describe('requireAdmin middleware', () => {
  it('should call handler if role is admin', async () => {
    const handler = jest.fn(async (req: any, res: any) => res.status(200).json({ ok: true }));
    const wrapped = requireAdmin(handler);
    const { req, res } = createMocks({ method: 'GET' });
    req.user = { _id: 'uid', role: 'admin' };
    await wrapped(req, res);
    expect(handler).toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(200);
  });

  it('should return 403 if role is user', async () => {
    const handler = jest.fn();
    const wrapped = requireAdmin(handler);
    const { req, res } = createMocks({ method: 'GET' });
    req.user = { _id: 'uid', role: 'user' };
    await wrapped(req, res);
    expect(handler).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(403);
  });

  it('should return 403 if no user', async () => {
    const handler = jest.fn();
    const wrapped = requireAdmin(handler);
    const { req, res } = createMocks({ method: 'GET' });
    await wrapped(req, res);
    expect(res._getStatusCode()).toBe(403);
  });
});
