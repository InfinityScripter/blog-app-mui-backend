// src/pages/api/user/avatar.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { userService } from '@/src/services/user';
import { validateBody } from '@/src/utils/validate';
import { emitAudit } from '@/src/utils/audit-context';
import { updateAvatarSchema } from '@/src/schemas/user';
import { withMethods } from '@/src/middlewares/with-methods';

// Thin route: auth → validate → service → respond. The file binary is uploaded
// separately via /api/upload, which returns a /api/file/:id path; this endpoint
// just persists that URL onto the user's avatar_url column.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  try {
    await dbConnect();
    const user = await userService.updateAvatar(req.user!._id, req.body);
    emitAudit(req, {
      action: 'user.avatar.updated',
      targetType: 'user',
      targetId: user._id,
    });
    return res.status(HTTP.OK).json({ message: MSG.AVATAR_UPDATED, success: true, user });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(withMethods(['POST'])(validateBody(updateAvatarSchema)(handler)));
