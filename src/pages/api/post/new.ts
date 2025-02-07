// src/pages/api/post/new.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import { Post } from '../../../models/Post';
import cors from '../../../utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    await dbConnect();
    await cors(req, res);

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
      author,
      favoritePerson,
    } = req.body;

    // Преобразуем теги и metaKeywords в массивы, если они пришли как строки
    const parsedTags =
      typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()) : tags;
    const parsedMetaKeywords =
      typeof metaKeywords === 'string'
        ? metaKeywords.split(',').map((k: string) => k.trim())
        : metaKeywords;

    // Если coverUrl приходит как объект, извлекаем строку из его поля (например, path)
    const coverUrlValue =
      coverUrl && typeof coverUrl === 'object'
        ? coverUrl.path || 'http://localhost:4444/assets/images/cover/cover-1.webp'
        : coverUrl || 'http://localhost:4444/assets/images/cover/cover-1.webp';

    // Если author отсутствует или не содержит name – задаем значения по умолчанию
    const authorInfo = author && author.name ? author : { name: 'Anonymous', avatarUrl: '' };

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
      author: authorInfo,
      favoritePerson: favoritePerson || [],
    };

    const post = await Post.create(newPost);
    return res.status(201).json({ message: 'Пост успешно создан', success: true, post });
  } catch (error: any) {
    console.error('[Post New API]: ', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}
