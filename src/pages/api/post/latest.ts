// src/pages/api/post/latest.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { paramCase } from '@/src/utils/change-case';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { title } = req.query;
    if (!title || typeof title !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Query parameter "title" is required.' });
    }
    const posts = await Post.find({}).sort({ createdAt: -1 }).lean();
    const latestPosts = posts.filter((p) => paramCase(p.title) !== title);
    if (latestPosts.length === 0) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'Posts not found!' });
    }
    res.status(HTTP.OK).json({ latestPosts });
  } catch (error: any) {
    console.error('[Post Latest API]: ', error);
    res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL });
  }
}
