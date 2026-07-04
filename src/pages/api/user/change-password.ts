// src/pages/api/user/change-password.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { userService } from '@/src/services/user';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/middlewares/validate';
import { changePasswordSchema } from '@/src/schemas/user';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';

// Thin route: auth → validate → service → respond. Verifies the current
// password before setting a new one. Distinct from auth/update-password, which
// resets via an emailed code rather than the existing password.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    await userService.changePassword(req.user!._id, req.body);
    emitAudit(req, {
      action: 'user.password.changed',
      targetType: 'user',
      targetId: req.user!._id,
    });
    return res.status(HTTP.OK).json({ message: MSG.PASSWORD_CHANGED, success: true });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(
  withMethods([HTTP_METHOD.POST])(validateBody(changePasswordSchema)(handler))
);
