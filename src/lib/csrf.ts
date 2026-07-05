import type { NextApiRequest } from 'next';

import crypto from 'crypto';
import { readCookie, CSRF_COOKIE } from '@/src/lib/cookies';

// ----------------------------------------------------------------------
// Double-submit CSRF. On login/refresh we set a NON-httpOnly `csrf_token`
// cookie; the SPA reads it and sends it back in the `X-CSRF-Token` header on
// every state-changing request. A cross-site attacker can trigger the browser
// to SEND the cookie automatically, but cannot READ it to populate the header
// (same-origin policy), so the header/cookie match proves same-origin intent.
//
// This only guards cookie-authenticated requests. The bot service-token path
// (Bearer BOT_API_TOKEN, no cookie) is not CSRF-exposed and is exempt upstream.

const CSRF_HEADER = 'x-csrf-token';

/** Random opaque CSRF token (256 bits, url-safe). */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Spend comparable time, then fail (uniform timing regardless of length).
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * True when the request carries a matching CSRF cookie + header pair. Fails
 * closed: any missing/empty/mismatched value → false.
 */
export function csrfValid(req: NextApiRequest): boolean {
  const cookieToken = readCookie(req, CSRF_COOKIE);
  const headerRaw = req.headers[CSRF_HEADER];
  const headerToken = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

  if (!cookieToken || !headerToken) return false;
  return safeEqual(cookieToken, headerToken);
}
