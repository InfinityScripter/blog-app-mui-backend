// src/pages/api/post/[id]/edit.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../../lib/db';
import { Post } from '../../../../models/Post';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Invalid post id' });
  }
  if (req.method !== 'PATCH' && req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    const {
      title,
      publish,
      metaKeywords,
      content,
      tags,
      metaTitle,
      coverUrl,
      totalViews,
      totalShares,
      totalComments,
      totalFavorites,
      metaDescription,
      description,
      author,
      favoritePerson,
    } = req.body;

    const parsedTags =
      typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()) : tags;
    const parsedMetaKeywords =
      typeof metaKeywords === 'string'
        ? metaKeywords.split(',').map((k: string) => k.trim())
        : metaKeywords;

    const updatedFields = {
      title,
      publish,
      metaKeywords: parsedMetaKeywords || [],
      content,
      tags: parsedTags || [],
      metaTitle,
      coverUrl,
      totalViews,
      totalShares,
      totalComments,
      totalFavorites,
      metaDescription,
      description,
      author,
      favoritePerson,
    };

    const updatedPost = await Post.findByIdAndUpdate(id, updatedFields, { new: true });
    if (!updatedPost) {
      return res.status(404).json({ message: 'Пост не найден' });
    }
    res.status(200).json({ message: 'Пост успешно обновлен', success: true, post: updatedPost });
  } catch (error: any) {
    console.error('[Post Edit API]: ', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}
