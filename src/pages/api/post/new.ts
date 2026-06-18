import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { fail } from '@/src/utils/response';
import { requireAuth } from '@/src/utils/auth';
import { buildNewPostPayload } from '@/src/utils/post-payload';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return fail(res, 405, 'Method not allowed');
  }
  try {
    await dbConnect();

    const user = await User.findById(req.user!._id).select('name avatarURL');
    if (!user) {
      return fail(res, 401, 'Пользователь не найден');
    }
    const author = { name: user.name, avatarUrl: user.avatarURL };

    // Извлекаем остальные поля из req.body
    const {
      title,
      publish,
      metaKeywords,
      content,
      tags,
      metaTitle,
      coverUrl,
      totalViews,
      totalShares,
      totalComments,
      totalFavorites,
      metaDescription,
      description,
      favoritePerson,
    } = req.body;

    const newPost = buildNewPostPayload(
      {
        title,
        publish,
        content,
        tags,
        metaKeywords,
        metaTitle,
        coverUrl,
        totalViews,
        totalShares,
        totalComments,
        totalFavorites,
        metaDescription,
        description,
        favoritePerson,
      },
      author,
      user._id
    );

    const post = await Post.create(newPost);
    return res.status(201).json({ message: 'Пост успешно создан', success: true, post });
  } catch (error: any) {
    console.error('[Post New API]: ', error);
    return fail(res, 500, 'Internal server error');
  }
}

export default requireAuth(handler);
