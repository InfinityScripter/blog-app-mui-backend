import '@jest/globals';
import cors from '@/src/utils/cors';
import { createMocks } from 'node-mocks-http';

describe('utils/cors (per-route CORS)', () => {
  it('reflects an allowed origin', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: { origin: 'https://aifirst.us.com' },
    });
    await cors(req as any, res as any);
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('https://aifirst.us.com');
    expect(res.getHeader('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('allows localhost dev origin', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: { origin: 'http://localhost:3033' },
    });
    await cors(req as any, res as any);
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('http://localhost:3033');
  });

  it('does NOT reflect a disallowed origin (security: no wildcard echo)', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: { origin: 'https://evil.example.com' },
    });
    await cors(req as any, res as any);
    expect(res.getHeader('Access-Control-Allow-Origin')).toBeUndefined();
  });

  it('does NOT echo when no origin header is present', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await cors(req as any, res as any);
    expect(res.getHeader('Access-Control-Allow-Origin')).toBeUndefined();
  });
});
