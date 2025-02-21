// src/pages/api/post/search.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import { Post } from '@/src/models/Post';
import cors from '../../../utils/cors';
import { verify } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    await cors(req, res);

    const { query, dashboard } = req.query;
    const cleanQuery = (query ? `${query}` : '').toLowerCase().trim();
    
    // Базовый фильтр
    let filter: any = {};

    // Если это поиск в dashboard
    if (dashboard === 'true') {
      const { authorization } = req.headers;
      if (!authorization) {
        return res.status(401).json({ message: 'Отсутствует токен авторизации' });
      }

      try {
        const token = authorization.split(' ')[1];
        const decoded: any = verify(token, JWT_SECRET);
        // Для dashboard поиск только по своим постам
        filter.userId = decoded.userId;
      } catch (err) {
        return res.status(401).json({ message: 'Неверный токен авторизации' });
      }
    } else {
      // Для публичного поиска только опубликованные посты
      filter.publish = 'published';
    }

    // Добавляем поиск по заголовку, если есть запрос
    if (cleanQuery !== '') {
      filter.title = { $regex: cleanQuery, $options: 'i' };
    }

    const results = await Post.find(filter).lean();
    res.status(200).json({ results });
  } catch (error: any) {
    console.error('[Post Search API]: ', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
