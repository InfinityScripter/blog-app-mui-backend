import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';

// Thin route: requireAuth → postService.deletePost → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.DELETE) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    await dbConnect();
    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid post id' });
    }
    await postService.deletePost(req.user!._id, id);
    emitAudit(req, { action: 'post.deleted', targetType: 'post', targetId: id });
    return res.status(HTTP.OK).json({ message: 'Пост успешно удалён', success: true });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
