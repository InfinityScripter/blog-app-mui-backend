import type { NextApiRequest, NextApiResponse } from 'next';
import { verify } from 'jsonwebtoken';
import { Post } from '@/src/models/Post';
import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import cors from '@/src/utils/cors';

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

    const parsedTags =
        typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()) : tags;
    const parsedMetaKeywords =
        typeof metaKeywords === 'string'
            ? metaKeywords.split(',').map((k: string) => k.trim())
            : metaKeywords;

    // Handle coverUrl from frontend
    let coverUrlValue = 'http://localhost:4444/assets/images/cover/cover-1.webp';
    if (coverUrl) {
        if (typeof coverUrl === 'string') {
            coverUrlValue = coverUrl;
        } else if (coverUrl.path) {
            const fileName = coverUrl.path.split('/').pop();
            coverUrlValue = `/uploads/${encodeURIComponent(fileName)}`;
        }
    }

    const newPost = {
      title,
      publish: publish || 'draft',
      metaKeywords: parsedMetaKeywords || [],
      content,
      tags: parsedTags || [],
      metaTitle,
      coverUrl: coverUrlValue,
      totalViews: totalViews || 0,
      totalShares: totalShares || 0,
      totalComments: totalComments || 0,
      totalFavorites: totalFavorites || 0,
      metaDescription,
      description,
      author,
      userId: user._id,
      favoritePerson: favoritePerson || [],
    };

    const post = await Post.create(newPost);
    return res.status(201).json({ message: 'Пост успешно создан', success: true, post });
  } catch (error: any) {
    console.error('[Post New API]: ', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}
