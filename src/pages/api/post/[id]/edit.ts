import type { NextApiRequest, NextApiResponse } from 'next';
import { verify } from 'jsonwebtoken';
import dbConnect from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import User from '@/src/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Invalid post id' });
  }
  if (req.method !== 'PATCH' && req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
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
    const user = await User.findById(decoded.userId).select('name avatarURL');
    if (!user) {
      return res.status(401).json({ message: 'Пользователь не найден' });
    }
    const author = { name: user.name, avatarUrl: user.avatarURL };

    // Находим пост и проверяем, что он принадлежит текущему пользователю
    const existingPost = await Post.findById(id);
    if (!existingPost) {
      return res.status(404).json({ message: 'Пост не найден' });
    }
    if (existingPost.userId.toString() !== String(user._id)) {
      return res.status(403).json({ message: 'Нет доступа к редактированию данного поста' });
    }

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
    let coverUrlValue = existingPost.coverUrl;
    if (coverUrl) {
        if (typeof coverUrl === 'string') {
            coverUrlValue = coverUrl;
        } else if (coverUrl.path) {
            const fileName = coverUrl.path.split('/').pop();
            coverUrlValue = `/uploads/${encodeURIComponent(fileName)}`;
        }
    }

    const updatedFields = {
      title,
      publish,
      metaKeywords: parsedMetaKeywords || [],
      content,
      tags: parsedTags || [],
      metaTitle,
      coverUrl: coverUrlValue,
      totalViews,
      totalShares,
      totalComments: existingPost.comments.length,
      totalFavorites,
      metaDescription,
      description,
      author, // заменяем данные автора данными из токена
      favoritePerson,
    };

    const updatedPost = await Post.findByIdAndUpdate(id, updatedFields, { new: true });
    if (!updatedPost) {
      return res.status(404).json({ message: 'Пост не найден' });
    }
    res.status(200).json({ message: 'Пост успешно обновлен', success: true, post: updatedPost });
  } catch (error: any) {
    console.error('[Post Edit API]: ', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}
