// src/pages/api/post/latest.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import { Post } from '@/src/models/Post';
import { paramCase } from '@/src/utils/change-case';
import dbConnect from '@/src/lib/db';
import cors from '@/src/utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    await cors(req, res);
    const { title } = req.query;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ message: 'Query parameter "title" is required.' });
    }
    const posts = await Post.find({}).sort({ createdAt: -1 }).lean();
    const latestPosts = posts.filter((p) => paramCase(p.title) !== title);
    if (latestPosts.length === 0) {
      return res.status(404).json({ message: 'Posts not found!' });
    }
    res.status(200).json({ latestPosts });
  } catch (error: any) {
    console.error('[Post Latest API]: ', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
