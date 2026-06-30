import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { Post } from '@/src/models/Post';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { HTTP_METHOD } from '@/src/constants/http';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { id } = req.query as { id: string };

  if (req.method === HTTP_METHOD.DELETE) {
    await Post.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: 'Post deleted' });
  }

  if (req.method === HTTP_METHOD.PUT) {
    const post = await Post.findByIdAndUpdate(id, req.body, { new: true });
    if (!post) return res.status(404).json({ message: 'Post not found' });
    return res.status(200).json({ post });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}

export default requireAuth(requireAdmin(handler));
