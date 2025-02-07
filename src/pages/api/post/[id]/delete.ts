import { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '@/src/lib/db';
import cors from '@/src/utils/cors';
import { Post } from '@/src/models/Post';

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

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    await Post.findByIdAndDelete(id);

    res.status(200).json({ message: 'Post deleted successfully' });
  } catch (error: any) {
    console.error('[Post Delete API]:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
