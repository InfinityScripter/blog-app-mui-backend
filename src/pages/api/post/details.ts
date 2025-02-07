// src/pages/api/post/details.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { paramCase } from '@/src/utils/change-case';
import { Post } from '@/src/models/Post';
import dbConnect from '@/src/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    await cors(req, res);
    const { title } = req.query;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ message: 'Query parameter "title" is required.' });
    }
    // Получаем все посты и ищем тот, у которого paramCase(title) совпадает с переданным параметром.
    const posts = await Post.find({}).lean();
    const found = posts.find((p) => paramCase(p.title) === title);
    if (!found) {
      return res.status(404).json({ message: 'Post not found!' });
    }
    res.status(200).json({ post: found });
  } catch (error: any) {
    console.error('[Post Details API]: ', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
