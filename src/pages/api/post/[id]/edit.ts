import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// Thin route: requireAuth → postService.updatePost → respond. Keeps { post }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid post id' });
  }
  if (req.method !== HTTP_METHOD.PATCH && req.method !== HTTP_METHOD.PUT) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  }
  try {
    const post = await postService.updatePost(req.user!._id, id, req.body ?? {});
    emitAudit(req, {
      action: 'post.updated',
      targetType: 'post',
      targetId: post.id,
      metadata: { publish: post.publish, updatedFieldNames: Object.keys(req.body ?? {}) },
    });
    return res.status(HTTP.OK).json({ message: 'Пост успешно обновлен', success: true, post });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
