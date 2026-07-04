import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';

// Thin route: requireAuth → postService.createPost → respond.
// Keeps the { post } key the frontend reads.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const post = await postService.createPost(req.user!._id, req.body);
    emitAudit(req, {
      action: 'post.created',
      targetType: 'post',
      targetId: post.id,
      metadata: {
        publish: post.publish,
        tagCount: post.tags?.length ?? 0,
        hasCover: Boolean(post.coverUrl),
      },
    });
    return res.status(HTTP.CREATED).json({ message: 'Пост успешно создан', success: true, post });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(withMethods([HTTP_METHOD.POST])(handler));
