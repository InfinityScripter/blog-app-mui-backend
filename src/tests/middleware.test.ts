import '@jest/globals';
import { NextRequest } from 'next/server';
import { middleware } from '@/src/middleware';

function makeRequest(method: string, origin?: string): NextRequest {
  const headers = new Headers();
  if (origin !== undefined) headers.set('origin', origin);
  return new NextRequest('https://api.aifirst.us.com/api/post/list', { method, headers });
}

describe('CORS middleware', () => {
  it('reflects an allowed origin in Access-Control-Allow-Origin', () => {
    const res = middleware(makeRequest('GET', 'https://aifirst.us.com'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://aifirst.us.com');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('allows localhost dev origin', () => {
    const res = middleware(makeRequest('GET', 'http://localhost:3033'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3033');
  });

  it('does NOT reflect a disallowed origin (no wildcard echo)', () => {
    const res = middleware(makeRequest('GET', 'https://evil.example.com'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers OPTIONS preflight with 200 and CORS headers for allowed origin', () => {
    const res = middleware(makeRequest('OPTIONS', 'https://aifirst.us.com'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://aifirst.us.com');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('does NOT reflect disallowed origin on OPTIONS preflight', () => {
    const res = middleware(makeRequest('OPTIONS', 'https://evil.example.com'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not emit console.log noise in production path', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    middleware(makeRequest('GET', 'https://aifirst.us.com'));
    middleware(makeRequest('OPTIONS', 'https://aifirst.us.com'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
