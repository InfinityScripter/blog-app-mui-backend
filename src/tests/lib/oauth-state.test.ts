import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { issueOAuthState, validateAndClearOAuthState } from '@/src/lib/oauth-state';

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0];
}

describe('OAuth state', () => {
  it('accepts the matching browser-bound state and clears its cookie', () => {
    const issued = createMocks({ method: 'GET' });
    const state = issueOAuthState(issued.req, issued.res, 'google');
    const setCookie = String(issued.res.getHeader('Set-Cookie'));
    const callback = createMocks({
      method: 'GET',
      headers: { cookie: cookiePair(setCookie) },
    });

    expect(validateAndClearOAuthState(callback.req, callback.res, 'google', state)).toBe(true);
    expect(String(callback.res.getHeader('Set-Cookie'))).toContain('Max-Age=0');
  });

  it('rejects a missing state', () => {
    const callback = createMocks({ method: 'GET' });
    expect(validateAndClearOAuthState(callback.req, callback.res, 'google', undefined)).toBe(false);
  });

  it('rejects a state that does not match the browser cookie', () => {
    const callback = createMocks({
      method: 'GET',
      headers: { cookie: 'oauth_state_google=expected-state' },
    });
    expect(validateAndClearOAuthState(callback.req, callback.res, 'google', 'attacker-state')).toBe(
      false
    );
  });
});
