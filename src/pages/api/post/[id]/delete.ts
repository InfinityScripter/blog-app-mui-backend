import { NextApiRequest, NextApiResponse } from 'next';
import { verify } from 'jsonwebtoken';
import dbConnect from '@/src/lib/db';
import cors from '@/src/utils/cors';
import { Post } from '@/src/models/Post';
import User from '@/src/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    await cors(req, res);

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Invalid post id' });
    }

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
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'Пользователь не найден' });
    }

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ message: 'Пост не найден' });
    }

    // Проверка, что пост принадлежит текущему пользователю
    if (post.userId.toString() !== String(user._id)) {
      return res.status(403).json({ message: 'Нет доступа к удалению данного поста' });
    }

    await Post.findByIdAndDelete(id);
    res.status(200).json({ message: 'Пост успешно удалён' });
  } catch (error: any) {
    console.error('[Post Delete API]:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
