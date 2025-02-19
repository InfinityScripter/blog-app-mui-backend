import type { NextApiRequest, NextApiResponse } from 'next';
import { verify } from 'jsonwebtoken';
import dbConnect from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import User from '@/src/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {

    try {
        await dbConnect();

        // Проверяем наличие токена в заголовке Authorization
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

        // Получаем пользователя из базы по userId из токена
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ message: 'Пользователь не найден' });
        }

        // Извлекаем id поста из query
        const { id } = req.query;
        if (!id || typeof id !== 'string') {
            return res.status(400).json({ message: 'Invalid post id' });
        }

        // Находим пост и проверяем, что он принадлежит текущему пользователю
        const post = await Post.findById(id);
        if (!post) {
            return res.status(404).json({ message: 'Пост не найден' });
        }
        if (post.userId.toString() !== String(user._id)) {
            return res.status(403).json({ message: 'Нет прав для изменения статуса публикации' });
        }

        // Получаем новое значение поля publish из тела запроса
        const { publish } = req.body;
        if (!publish || (publish !== 'draft' && publish !== 'published')) {
            return res.status(400).json({ message: 'Неверное значение поля publish' });
        }

        // Обновляем только поле publish
        post.publish = publish;
        await post.save();

        return res.status(200).json({ message: 'Статус публикации обновлён', post });
    } catch (error: any) {
        console.error('[Post Publish API]: ', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
