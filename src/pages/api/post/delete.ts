import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { requireAuth } from '@/src/utils/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    await cors(req, res);

    const { postId } = req.query;

    if (!postId) {
      return res.status(400).json({ message: 'Post ID is required' });
    }

    // Найти пост
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Проверяем, является ли пользователь автором поста
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (post.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this post' });
    }

    // Удалить пост
    await Post.findByIdAndDelete(postId);

    return res.status(200).json({
      message: 'Post deleted successfully',
      success: true,
    });
  } catch (error: any) {
    console.error('[Post Delete API]: ', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}

export default requireAuth(handler);
