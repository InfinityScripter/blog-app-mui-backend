import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';

interface DogsAdminTokenPayload {
  scope: 'dogs-admin';
}

function timingSafeStringEqual(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function getAdminPassword() {
  const password = process.env.DOGS_ADMIN_PASSWORD;
  if (!password) {
    throw new AppError(HTTP.SERVICE_UNAVAILABLE, 'Dogs admin password is not configured');
  }
  return password;
}

function getSessionSecret() {
  const secret = process.env.DOGS_ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new AppError(HTTP.SERVICE_UNAVAILABLE, 'Dogs admin session secret is not configured');
  }
  return secret;
}

export function createDogsAdminToken(password: string) {
  if (!timingSafeStringEqual(password, getAdminPassword())) {
    throw new AppError(HTTP.UNAUTHORIZED, 'Unauthorized');
  }

  const payload: DogsAdminTokenPayload = { scope: 'dogs-admin' };
  return jwt.sign(payload, getSessionSecret(), { expiresIn: '7d' });
}

function isDogsAdminToken(token: string) {
  try {
    const decoded = jwt.verify(token, getSessionSecret()) as Partial<DogsAdminTokenPayload>;
    return decoded.scope === 'dogs-admin';
  } catch {
    return false;
  }
}

export const requireDogsAdmin =
  (handler: NextApiHandler) => async (req: NextApiRequest, res: NextApiResponse) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    if (!isDogsAdminToken(token)) {
      return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: 'Unauthorized' });
    }

    return handler(req, res);
  };
