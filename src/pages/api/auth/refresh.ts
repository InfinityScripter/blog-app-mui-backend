// src/pages/api/auth/refresh.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { sendError } from '@/src/utils/response';
import { rotateRefresh } from '@/src/services/refresh';
import { withCsrf } from '@/src/middlewares/with-csrf';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withMethods } from '@/src/middlewares/with-methods';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { readCookie, REFRESH_COOKIE, setAuthCookies, clearAuthCookies } from '@/src/lib/cookies';

// Rotate the refresh token: read it from the httpOnly cookie, exchange for a
// fresh access+refresh pair (rotation with theft detection), set new cookies.
// On any invalid/expired/forged/reused token → clear cookies + 401. CSRF is
// enforced (this is a state-changing, cookie-authenticated endpoint).
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();

    const rawToken = readCookie(req, REFRESH_COOKIE);
    if (!rawToken) {
      clearAuthCookies(req, res);
      return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: 'No refresh token' });
    }

    const { accessToken, refreshToken, csrfToken, user } = await rotateRefresh(
      rawToken,
      req.headers['user-agent'] ?? null
    );
    setAuthCookies(req, res, { accessToken, refreshToken, csrfToken });
    return res.status(HTTP.OK).json({ success: true, user });
  } catch (error) {
    // Any refresh failure ends the session — clear cookies so the client stops
    // retrying with a dead token.
    clearAuthCookies(req, res);
    return sendError(res, error);
  }
}

// ~20/min per IP: generous for legit silent refresh, still caps abuse.
export default withRateLimit({ routeName: 'auth.refresh', windowMs: 60_000, max: 20 })(
  withMethods([HTTP_METHOD.POST])(withCsrf(handler))
);
