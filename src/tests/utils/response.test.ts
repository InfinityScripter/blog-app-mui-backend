import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { ok, fail } from '@/src/utils/response';

describe('response helpers', () => {
  it('ok() sends success:true with data and default 200', () => {
    const { res } = createMocks();
    ok(res as any, { posts: [1, 2] });
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ posts: [1, 2] });
  });

  it('ok() honours a custom status and message', () => {
    const { res } = createMocks();
    ok(res as any, { id: 'x' }, { status: 201, message: 'created' });
    expect(res._getStatusCode()).toBe(201);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.message).toBe('created');
    expect(body.data).toEqual({ id: 'x' });
  });

  it('fail() sends success:false with message and the given status', () => {
    const { res } = createMocks();
    fail(res as any, 404, 'Not found');
    expect(res._getStatusCode()).toBe(404);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(false);
    expect(body.message).toBe('Not found');
  });
});
