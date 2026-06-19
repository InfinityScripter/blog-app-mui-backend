import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { withMethods } from '@/src/middlewares/with-methods';

// Thin route: requireAuth → postService.createPost → respond.
// Keeps the { post } key the frontend reads.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const post = await postService.createPost(req.user!._id, req.body);
    return res.status(HTTP.CREATED).json({ message: 'Пост успешно создан', success: true, post });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(withMethods(['POST'])(handler));
