import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from 'src/lib/db';
import { Post } from 'src/models/Post';
import User from '@/src/models/User';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Invalid post id' });
    }

    const post = await Post.findOne({ _id: id });
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Populate user data for reply comments
    for (const comment of post.comments) {
      for (const reply of comment.replyComment) {
        const user = await User.findOne({ _id: reply.userId });
        if (user) {
          reply.userName = user.name;
          reply.userAvatar = user.avatarURL;
        }
      }
    }

    res.status(200).json({ post });
  } catch (error) {
    console.error('[Post Details API]:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
