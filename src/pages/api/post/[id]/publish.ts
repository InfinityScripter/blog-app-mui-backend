import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { emitAudit } from '@/src/utils/audit-context';
import { setPublishSchema } from '@/src/schemas/post';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/middlewares/validate';
import { withMethods } from '@/src/middlewares/with-methods';
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

// POST|PATCH|PUT: фронт исторически звал роут без фиксированного метода, так
// что разрешены все мутационные глаголы. Главное — GET больше не мутирует
// (GET обходит CSRF-гейт двойной отправки, мутация на нём — дыра в гигиене).
export default requireAuth(
  withMethods([HTTP_METHOD.POST, HTTP_METHOD.PATCH, HTTP_METHOD.PUT])(
    validateBody(setPublishSchema)(handler)
  )
);
