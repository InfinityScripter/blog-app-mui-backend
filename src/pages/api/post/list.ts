// src/pages/api/post/list.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import { Post } from '../../../models/Post';
import cors from '../../../utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    await cors(req, res);
    const posts = await Post.find({}).lean();
    res.status(200).json({ posts });
  } catch (error: any) {
    console.error('[Post List API]: ', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
