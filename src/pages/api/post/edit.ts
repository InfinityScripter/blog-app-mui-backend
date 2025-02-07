// src/pages/api/post/edit.ts
import type {NextApiRequest, NextApiResponse} from 'next';
import dbConnect from '../../../lib/db';
import {Post} from '../../../models/Post';
import {paramCase} from '../../../utils/change-case';
import cors from '../../../utils/cors';

/**
 * PUT /api/post/edit?title=<paramCase>
 *
 * Body (JSON):
 * {
 *   "title": "New Title",
 *   "description": "Updated desc",
 *   "content": "Updated content",
 *   ...
 * }
 *
 * Пример:
 * fetch('/api/post/edit?title=hello-world', {
 *   method: 'PUT',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ title: 'New Title', content: 'New content' })
 * })
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        await dbConnect();
        await cors(req, res);

        if (req.method !== 'PUT') {
            return res.status(405).json({ message: 'Method not allowed. Use PUT.' });
        }

        const { title } = req.query;
        if (!title || typeof title !== 'string') {
            return res.status(400).json({ message: 'Query parameter "title" is required.' });
        }

        // Данные для обновления
        const {
            title: newTitle,
            description,
            content,
            tags,
            metaTitle,
            coverUrl,
            totalViews,
            totalShares,
            totalComments,
            totalFavorites,
            metaDescription,
            author,
            favoritePerson,
        } = req.body;

        // Сначала получаем все посты, потом ищем тот, у которого paramCase(p.title) === title
        const posts = await Post.find({}).lean();
        const foundPost = posts.find((p) => paramCase(p.title) === title);

        if (!foundPost) {
            return res.status(404).json({ message: 'Post not found!' });
        }

        // Обновляем в базе (используем foundPost._id)
        const updatedPost = await Post.findByIdAndUpdate(
            foundPost._id,
            {
                ...(newTitle && { title: newTitle }),
                ...(description && { description }),
                ...(content && { content }),
                ...(tags && { tags }),
                ...(metaTitle && { metaTitle }),
                ...(coverUrl && { coverUrl }),
                ...(totalViews && { totalViews }),
                ...(totalShares && { totalShares }),
                ...(totalComments && { totalComments }),
                ...(totalFavorites && { totalFavorites }),
                ...(metaDescription && { metaDescription }),
                ...(author && { author }),
                ...(favoritePerson && { favoritePerson }),
            },
            { new: true }
        );

        return res.status(200).json({ message: 'Post updated', post: updatedPost });
    } catch (error: any) {
        console.error('[Post Edit API]: ', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
