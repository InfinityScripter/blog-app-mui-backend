import type { NextApiRequest, NextApiResponse } from 'next';

import { randomBytes } from 'node:crypto';
import { safeEqual } from '@/src/utils/safe-equal';
import { isSecureRequest } from '@/src/lib/cookies';

type OAuthProvider = 'google' | 'yandex';

function cookieName(provider: OAuthProvider): string {
  return `oauth_state_${provider}`;
}

function callbackPath(provider: OAuthProvider): string {
  return `/api/auth/${provider}/callback`;
}

function readCookie(req: NextApiRequest, name: string): string | null {
  const cookie = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

function cookieAttrs(req: NextApiRequest, provider: OAuthProvider): string {
  return `Path=${callbackPath(provider)}; HttpOnly; SameSite=Lax${
    isSecureRequest(req) ? '; Secure' : ''
  }`;
}

export function issueOAuthState(
  req: NextApiRequest,
  res: NextApiResponse,
  provider: OAuthProvider
): string {
  const state = randomBytes(32).toString('base64url');
  res.setHeader(
    'Set-Cookie',
    `${cookieName(provider)}=${state}; Max-Age=600; ${cookieAttrs(req, provider)}`
  );
  return state;
}

export function validateAndClearOAuthState(
  req: NextApiRequest,
  res: NextApiResponse,
  provider: OAuthProvider,
  receivedState: unknown
): boolean {
  const expectedState = readCookie(req, cookieName(provider));
  res.setHeader('Set-Cookie', `${cookieName(provider)}=; Max-Age=0; ${cookieAttrs(req, provider)}`);
  return (
    typeof receivedState === 'string' &&
    typeof expectedState === 'string' &&
    safeEqual(receivedState, expectedState)
  );
}
