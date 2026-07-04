import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { emitAudit } from '@/src/utils/audit-context';
import { requireAuth } from '@/src/middlewares/require-auth';

// Thin route: requireAuth → postService.setPublish → respond. Keeps { post }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid post id' });
    }
    const post = await postService.setPublish(req.user!._id, id, req.body?.publish);
    emitAudit(req, {
      action: 'post.publish_changed',
      targetType: 'post',
      targetId: post.id,
      metadata: { publish: post.publish },
    });
    return res.status(HTTP.OK).json({ message: 'Статус публикации обновлён', post });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
