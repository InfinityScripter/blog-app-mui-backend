import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { requireAuth } from '@/src/utils/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    await cors(req, res);

    const { postId, title, description, content, tags, metaKeywords, coverUrl, metaTitle, metaDescription } = req.body;

    if (!postId) {
      return res.status(400).json({ message: 'Post ID is required' });
    }

    // Найти пост
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Проверяем, является ли пользователь автором поста
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (post.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this post' });
    }

    // Подготовка данных для обновления
    const updateData: any = {};

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (content !== undefined) updateData.content = content;

    if (tags !== undefined) {
      const parsedTags = typeof tags === 'string'
        ? tags.split(',').map((t: string) => t.trim())
        : tags;
      updateData.tags = parsedTags;
    }

    if (metaKeywords !== undefined) {
      const parsedMetaKeywords = typeof metaKeywords === 'string'
        ? metaKeywords.split(',').map((k: string) => k.trim())
        : metaKeywords;
      updateData.metaKeywords = parsedMetaKeywords;
    }

    if (coverUrl !== undefined) {
      let coverUrlValue = coverUrl;
      if (typeof coverUrl !== 'string' && coverUrl?.path) {
        // Если это новая загрузка файла
        coverUrlValue = coverUrl.path;
      }
      updateData.coverUrl = coverUrlValue;
    }

    if (metaTitle !== undefined) updateData.metaTitle = metaTitle;
    if (metaDescription !== undefined) updateData.metaDescription = metaDescription;
    updateData.updatedAt = new Date();

    // Обновить пост
    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $set: updateData },
      { new: true } // Вернуть обновленный документ
    );

    return res.status(200).json({
      message: 'Post updated successfully',
      success: true,
      post: updatedPost
    });
  } catch (error: any) {
    console.error('[Post Update API]: ', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}

export default requireAuth(handler);
