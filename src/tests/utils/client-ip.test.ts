import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { getClientIp, getTrustedClientIp } from '@/src/utils/client-ip';

function reqWith(headers: Record<string, string>) {
  const { req } = createMocks({ headers });
  return req;
}

describe('getTrustedClientIp (rate-limit key, 1 trusted proxy)', () => {
  it('returns the single XFF entry when there is exactly one', () => {
    expect(getTrustedClientIp(reqWith({ 'x-forwarded-for': '1.2.3.4' }))).toBe('1.2.3.4');
  });

  it('ignores spoofed LEFTMOST entries and returns the proxy-appended (rightmost) IP', () => {
    // nginx appends the real peer at the right; that is the trusted client IP.
    expect(
      getTrustedClientIp(reqWith({ 'x-forwarded-for': 'evil-spoof, 9.9.9.9' }))
    ).toBe('9.9.9.9');
    // Rotating the leftmost spoof does not change the result → same rate bucket.
    expect(
      getTrustedClientIp(reqWith({ 'x-forwarded-for': 'other-spoof, 9.9.9.9' }))
    ).toBe('9.9.9.9');
  });

  it('falls back to X-Real-IP then socket when XFF is absent', () => {
    expect(getTrustedClientIp(reqWith({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
  });

  it('getClientIp (audit, best-effort) still reads the leftmost entry', () => {
    // Documents the intentional difference: audit uses leftmost, security uses trusted.
    expect(getClientIp(reqWith({ 'x-forwarded-for': 'client, proxy' }))).toBe('client');
  });
});
