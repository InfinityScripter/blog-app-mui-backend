import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { requireAuth } from '@/src/utils/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Invalid post id' });
    }

    const user = await User.findById(req.user!._id);
    if (!user) {
      return res.status(401).json({ message: 'Пользователь не найден' });
    }

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ message: 'Пост не найден' });
    }

    // Проверка, что пост принадлежит текущему пользователю
    if (post.userId.toString() !== String(user._id)) {
      return res.status(403).json({ message: 'Нет доступа к удалению данного поста' });
    }

    await Post.findByIdAndDelete(id);
    res.status(200).json({ message: 'Пост успешно удалён' });
  } catch (error: any) {
    console.error('[Post Delete API]:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export default requireAuth(handler);
