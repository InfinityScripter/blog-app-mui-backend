// src/pages/api/post/list.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { Post } from '@/src/models/Post';
import { verify } from 'jsonwebtoken';
import dbConnect from '@/src/lib/db';
import cors from '@/src/utils/cors';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    await cors(req, res);
    let filter = {};
    const { authorization } = req.headers;
    if (authorization) {
      try {
        const token = authorization.split(' ')[1];
        const decoded: any = verify(token, JWT_SECRET);
        // Ограничиваем выборку постов только теми, где поле userId соответствует идентификатору из токена
        filter = { userId: decoded.userId };
      } catch (err) {
        return res.status(401).json({ message: 'Неверный токен авторизации' });
      }
    }
    const posts = await Post.find(filter).lean();
    res.status(200).json({ posts });
  } catch (error: any) {
    console.error('[Post List API]: ', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
