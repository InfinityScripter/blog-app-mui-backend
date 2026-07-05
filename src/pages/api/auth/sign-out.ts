// src/pages/api/auth/sign-out.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { sendError } from '@/src/utils/response';
import RefreshToken from '@/src/models/RefreshToken';
import { withCsrf } from '@/src/middlewares/with-csrf';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withMethods } from '@/src/middlewares/with-methods';
import { readCookie, REFRESH_COOKIE, clearAuthCookies } from '@/src/lib/cookies';

// Log out: revoke the presented refresh token's family (server-side, so the
// token can't be reused) and clear all auth cookies. Idempotent — a missing or
// already-revoked token still clears cookies and returns 200. CSRF-protected.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();

    const rawToken = readCookie(req, REFRESH_COOKIE);
    if (rawToken) {
      const row = await RefreshToken.findByRawToken(rawToken);
      if (row) {
        await RefreshToken.revokeFamily(row.familyId);
      }
    }

    clearAuthCookies(req, res);
    return res.status(HTTP.OK).json({ success: true });
  } catch (error) {
    clearAuthCookies(req, res);
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.POST])(withCsrf(handler));
