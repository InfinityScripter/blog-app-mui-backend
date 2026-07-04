import type { NextApiRequest, NextApiResponse } from 'next';

import { Post } from '@/src/models/Post';
import { MSG } from '@/src/constants/messages';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query as { id: string };

  if (req.method === HTTP_METHOD.DELETE) {
    await Post.findByIdAndDelete(id);
    return res.status(HTTP.OK).json({ success: true, message: 'Post deleted' });
  }

  if (req.method === HTTP_METHOD.PUT) {
    const post = await Post.findByIdAndUpdate(id, req.body, { new: true });
    if (!post) return res.status(HTTP.NOT_FOUND).json({ message: 'Post not found' });
    return res.status(HTTP.OK).json({ post });
  }

  return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
}

export default requireAuth(requireAdmin(handler));
