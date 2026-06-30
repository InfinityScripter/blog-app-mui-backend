// src/pages/api/user/change-password.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { MSG } from '@/src/constants/messages';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { userService } from '@/src/services/user';
import { validateBody } from '@/src/utils/validate';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { changePasswordSchema } from '@/src/schemas/user';
import { withMethods } from '@/src/middlewares/with-methods';

// Thin route: auth → validate → service → respond. Verifies the current
// password before setting a new one. Distinct from auth/update-password, which
// resets via an emailed code rather than the existing password.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
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
