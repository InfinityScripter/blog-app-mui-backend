// src/pages/api/post/new.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import { Post } from '../../../models/Post';
import cors from '../../../utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }
  try {
    await dbConnect();
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

    // Если теги или metaKeywords пришли как строка, преобразуем в массив
    const parsedTags =
      typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()) : tags;
    const parsedMetaKeywords =
      typeof metaKeywords === 'string'
        ? metaKeywords.split(',').map((k: string) => k.trim())
        : metaKeywords;

    const newPost = {
      title,
      publish: publish || 'draft',
      metaKeywords: parsedMetaKeywords || [],
      content,
      tags: parsedTags || [],
      metaTitle,
      coverUrl,
      totalViews: totalViews || 0,
      totalShares: totalShares || 0,
      totalComments: totalComments || 0,
      totalFavorites: totalFavorites || 0,
      metaDescription,
      description,
      author,
      favoritePerson: favoritePerson || [],
    };

    const post = await Post.create(newPost);
    res.status(201).json({ message: 'Пост успешно создан', success: true, post });
  } catch (error: any) {
    console.error('[Post New API]: ', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}
