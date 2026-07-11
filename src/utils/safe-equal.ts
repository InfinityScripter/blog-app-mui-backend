import crypto from 'node:crypto';

/**
 * Constant-time string equality for secrets (webhook tokens, API keys). Compares
 * length first so timingSafeEqual never throws on a mismatch; on a length
 * mismatch it still spends comparable time before returning false, so the
 * timing profile doesn't leak where/whether the value differs. Prefer this over
 * `===` for anything an attacker can probe repeatedly.
 */
export function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
