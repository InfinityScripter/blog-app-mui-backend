import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { verify } from 'jsonwebtoken';
import { Post } from '@/src/models/Post';
import { buildNewPostPayload } from '@/src/utils/post-payload';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    await dbConnect();
    await cors(req, res);

    // Извлечение и верификация токена
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(401).json({ message: 'Отсутствует токен авторизации' });
    }
    const token = authorization.split(' ')[1];
    let decoded: any;
    try {
      decoded = verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Неверный токен авторизации' });
    }
    // Получаем пользователя по decoded.userId
    const user = await User.findById(decoded.userId).select('name avatarURL');
    if (!user) {
      return res.status(401).json({ message: 'Пользователь не найден' });
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
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}
