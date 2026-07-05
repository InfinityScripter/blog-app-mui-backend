import type { SignOptions } from 'jsonwebtoken';

import jwt from 'jsonwebtoken';

// ----------------------------------------------------------------------
// Single source of truth for JWT config. Previously `process.env.JWT_SECRET
// || 'secret123'` was duplicated across ~16 files — in production with the
// env unset that silently signed/verified tokens with a publicly-known weak
// secret. Here we fail fast instead.

function resolveSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is not set — refusing to start in production with a default secret.'
    );
  }
  // dev/test convenience only; never reached in production.
  return 'dev_only_insecure_secret';
}

export const JWT_SECRET: string = resolveSecret();

// Access token is now SHORT-LIVED (default 15m) and rides in an httpOnly cookie;
// the axios refresh interceptor renews it transparently. A dedicated env var is
// used on purpose so the legacy `JWT_EXPIRES_IN=30d` in prod .env does NOT keep
// access tokens alive for 30 days — the short-access guarantee holds without a
// prod env edit. Long-lived sessions are carried by the rotating refresh token.
export const JWT_ACCESS_EXPIRES_IN = (process.env.JWT_ACCESS_EXPIRES_IN ||
  '15m') as SignOptions['expiresIn'];

// Refresh token lifetime (the DB row's expiry is derived from this). Falls back
// to the legacy JWT_EXPIRES_IN if set, else 30d.
export const JWT_REFRESH_EXPIRES_IN = (process.env.JWT_REFRESH_EXPIRES_IN ||
  process.env.JWT_EXPIRES_IN ||
  '30d') as SignOptions['expiresIn'];

export interface JwtPayload {
  userId: string;
  role?: string;
  [key: string]: unknown;
}

/** Sign a short-lived ACCESS token. */
export function signToken(payload: JwtPayload, options?: SignOptions): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRES_IN, ...options });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

/**
 * Refresh lifetime as milliseconds, for computing a cookie Max-Age and the DB
 * `expires_at`. Supports the `'30d' | '12h' | '900s' | number(seconds)` forms
 * we actually use; falls back to 30 days on anything unrecognised.
 */
export function refreshExpiresInMs(): number {
  const raw = JWT_REFRESH_EXPIRES_IN;
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  if (typeof raw === 'number') return raw * 1000;
  if (typeof raw !== 'string') return THIRTY_DAYS;

  const match = raw.match(/^(\d+)\s*([smhd])?$/);
  if (!match) return THIRTY_DAYS;
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * (unitMs[unit] ?? 1000);
}
