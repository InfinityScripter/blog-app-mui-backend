import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { CSRF_COOKIE } from '@/src/lib/cookies';
import { csrfValid, generateCsrfToken } from '@/src/lib/csrf';

describe('lib/csrf', () => {
  it('generates distinct high-entropy tokens', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it('passes when cookie and header match (double-submit)', () => {
    const token = generateCsrfToken();
    const { req } = createMocks({
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE}=${token}`, 'x-csrf-token': token },
    });
    expect(csrfValid(req)).toBe(true);
  });

  it('fails when the header is missing', () => {
    const token = generateCsrfToken();
    const { req } = createMocks({ method: 'POST', headers: { cookie: `${CSRF_COOKIE}=${token}` } });
    expect(csrfValid(req)).toBe(false);
  });

  it('fails when the cookie is missing', () => {
    const token = generateCsrfToken();
    const { req } = createMocks({ method: 'POST', headers: { 'x-csrf-token': token } });
    expect(csrfValid(req)).toBe(false);
  });

  it('fails when cookie and header differ', () => {
    const { req } = createMocks({
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE}=aaaaaaaa`, 'x-csrf-token': 'bbbbbbbb' },
    });
    expect(csrfValid(req)).toBe(false);
  });

  it('fails closed on empty values', () => {
    const { req } = createMocks({
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE}=`, 'x-csrf-token': '' },
    });
    expect(csrfValid(req)).toBe(false);
  });
});
