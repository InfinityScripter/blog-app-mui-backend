// pages/api/post/details.js
import dbConnect from 'src/lib/db';
import { Post } from 'src/models/Post';

export default async function handler(req: any, res: any) {
  await dbConnect();
  const { id } = req.query; // изменили на id
  if (req.method === 'GET') {
    try {
      const post = await Post.findById(id);
      if (!post) {
        return res.status(404).json({ message: 'Пост не найден' });
      }
      return res.status(200).json({ post });
    } catch (error) {
      console.error('Ошибка получения деталей поста:', error);
      return res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Метод ${req.method} не разрешён` });
  }
}
