// src/pages/api/auth/sign-in.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import { isAppError } from '@/src/types/api';
import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { signInSchema } from '@/src/schemas/auth';
import { authService } from '@/src/services/auth';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/middlewares/validate';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { withMethods } from '@/src/middlewares/with-methods';

// Thin route: validate → service → respond. Logic lives in authService.
// Keeps the { accessToken, user } top-level keys the frontend reads.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { accessToken, user } = await authService.signIn(req.body);
    emitAudit(req, {
      action: 'auth.login.succeeded',
      actorId: user._id,
      actorRole: user.role,
      targetType: 'user',
      targetId: user._id,
      metadata: { method: 'password' },
    });
    return res.status(HTTP.OK).json({ accessToken, user });
  } catch (error) {
    // Anonymous failure — never log the attempted email (PII / enumeration).
    // A locked account surfaces as 403 ACCOUNT_LOCKED; everything else is a
    // generic failed login (wrong creds incl. the silent lock-crossing attempt,
    // or email-not-verified).
    const locked = isAppError(error) && error.message === MSG.ACCOUNT_LOCKED;
    emitAudit(req, {
      action: locked ? 'auth.account.locked' : 'auth.login.failed',
      targetType: 'user',
      metadata: { method: 'password', reason: locked ? 'account_locked' : 'invalid' },
    });
    return sendError(res, error);
  }
}

// ~5/min per IP — brute-force guard on credential submission (outermost).
export default withRateLimit({ routeName: 'auth.sign-in', windowMs: 60_000, max: 5 })(
  withMethods([HTTP_METHOD.POST])(validateBody(signInSchema)(handler))
);
