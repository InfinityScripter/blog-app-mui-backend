// src/pages/api/post/list.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { verify } from 'jsonwebtoken';
import { Post } from '@/src/models/Post';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    await cors(req, res);

    let filter: any = {};
    const { authorization } = req.headers;

    if (authorization) {
      try {
        const token = authorization.split(' ')[1];
        const decoded: any = verify(token, JWT_SECRET);
        // Для авторизованных пользователей показываем их посты (и draft, и published)
        filter = { userId: decoded.userId };
      } catch (err) {
        // Если токен неверный, показываем только опубликованные посты
        filter = { publish: 'published' };
      }
    } else {
      // Для неавторизованных пользователей показываем только опубликованные посты
      filter = { publish: 'published' };
    }

    const posts = await Post.find(filter).lean();
    const updatedPosts = posts.map(post => ({
        ...post,
        totalComments: post.comments ? post.comments.length : 0
      }));
    res.status(200).json({ posts: updatedPosts });
  } catch (error: any) {
    console.error('[Post List API]: ', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
