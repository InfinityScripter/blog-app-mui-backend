// src/pages/api/user/avatar.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { AppError } from '@/src/types/api';
import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { userService } from '@/src/services/user';
import { emitAudit } from '@/src/utils/audit-context';
import { updateAvatarSchema } from '@/src/schemas/user';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';

// Thin route. POST sets the avatar to an already-uploaded /api/file/:id URL
// (the binary is uploaded separately via /api/upload); DELETE clears it.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const userId = req.user!._id;

    if (req.method === HTTP_METHOD.DELETE) {
      const user = await userService.removeAvatar(userId);
      emitAudit(req, {
        action: 'user.avatar.removed',
        targetType: 'user',
        targetId: user._id,
      });
      return res.status(HTTP.OK).json({ message: MSG.AVATAR_REMOVED, success: true, user });
    }

    // POST — validate the body inline (the route allows two methods, so the
    // validateBody wrapper can't gate just one of them).
    const parsed = updateAvatarSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        HTTP.BAD_REQUEST,
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }

    const user = await userService.updateAvatar(userId, parsed.data);
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

export default requireAuth(withMethods([HTTP_METHOD.POST, HTTP_METHOD.DELETE])(handler));
