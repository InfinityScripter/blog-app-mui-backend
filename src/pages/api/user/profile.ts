// src/pages/api/user/profile.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { userService } from '@/src/services/user';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { updateProfileSchema } from '@/src/schemas/user';
import { validateBody } from '@/src/middlewares/validate';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';

// Thin route: auth → validate → service → respond. Updates the caller's
// display name. Keeps the top-level { user } key the frontend reads (see /me).
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const user = await userService.updateProfile(req.user!._id, req.body);
    emitAudit(req, {
      action: 'user.profile.updated',
      targetType: 'user',
      targetId: user._id,
      metadata: { fields: ['name'] },
    });
    return res.status(HTTP.OK).json({ message: MSG.PROFILE_UPDATED, success: true, user });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(
  withMethods([HTTP_METHOD.PATCH])(validateBody(updateProfileSchema)(handler))
);
