import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { emitAudit } from '@/src/utils/audit-context';

// Thin route: requireAuth → postService.updatePost → respond. Keeps { post }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid post id' });
  }
  if (req.method !== 'PATCH' && req.method !== 'PUT') {
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
