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
    throw new Error('JWT_SECRET is not set — refusing to start in production with a default secret.');
  }
  // dev/test convenience only; never reached in production.
  return 'dev_only_insecure_secret';
}

export const JWT_SECRET: string = resolveSecret();

export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '30d') as SignOptions['expiresIn'];

export interface JwtPayload {
  userId: string;
  role?: string;
  [key: string]: unknown;
}

export function signToken(payload: JwtPayload, options?: SignOptions): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, ...options });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
