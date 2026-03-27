import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { requireAuth } from '@/src/utils/auth';
import { buildPostPatchPayload } from '@/src/utils/post-payload';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    await cors(req, res);

    const {
      postId,
      title,
      description,
      content,
      tags,
      metaKeywords,
      coverUrl,
      metaTitle,
      metaDescription,
    } = req.body;

    if (!postId || typeof postId !== 'string') {
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

    const updateData = buildPostPatchPayload(
      {
        title,
        description,
        content,
        tags,
        metaKeywords,
        coverUrl,
        metaTitle,
        metaDescription,
      },
      {
        coverUrlFallback: post.coverUrl,
      }
    );

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
      post: updatedPost,
    });
  } catch (error: any) {
    console.error('[Post Update API]: ', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}

export default requireAuth(handler);
