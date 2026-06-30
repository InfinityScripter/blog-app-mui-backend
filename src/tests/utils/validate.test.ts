import '@jest/globals';
import { z } from 'zod';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/utils/validate';

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().positive(),
});

describe('validateBody middleware', () => {
  it('passes a valid body through to the handler', async () => {
    const handler = jest.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = validateBody(schema)(handler as any);
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'a@b.com', age: 5 },
    });

    await wrapped(req as any, res as any);

    expect(handler).toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(200);
  });

  it('rejects an invalid body with 400 and does not call the handler', async () => {
    const handler = jest.fn();
    const wrapped = validateBody(schema)(handler as any);
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'not-an-email', age: -1 },
    });

    await wrapped(req as any, res as any);

    expect(handler).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/valid|invalid|required|email/i);
  });

  it('rejects a missing required field with 400', async () => {
    const handler = jest.fn();
    const wrapped = validateBody(schema)(handler as any);
    const { req, res } = createMocks({ method: HTTP_METHOD.POST, body: { email: 'a@b.com' } });

    await wrapped(req as any, res as any);

    expect(handler).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(400);
  });
});
