// src/pages/api/auth/sign-out-all.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { sendError } from '@/src/utils/response';
import RefreshToken from '@/src/models/RefreshToken';
import { clearAuthCookies } from '@/src/lib/cookies';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';

// "Sign out everywhere": revoke every refresh token for the authenticated user
// (kills all their sessions on every device) and clear this device's cookies.
// requireAuth already enforces CSRF on the cookie path for this POST.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    await RefreshToken.revokeAllForUser(req.user!._id);
    clearAuthCookies(req, res);
    return res.status(HTTP.OK).json({ success: true });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.POST])(requireAuth(handler));
