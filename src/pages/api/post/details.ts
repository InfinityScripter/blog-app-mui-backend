import type { NextApiRequest, NextApiResponse } from 'next';

import User from '@/src/models/User';

import cors from 'src/utils/cors';

import dbConnect from 'src/lib/db';
import { Post } from 'src/models/Post';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Invalid post id' });
    }

    // Pure read. View counting lives in POST /api/post/[id]/view so that SSR
    // prerenders and SWR revalidations don't inflate the counter.
    const post = await Post.findById(id);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    post.totalComments = post.comments.length;
    // Populate user data for reply comments
    const populateUserData = async () => {
      const userPromises: Promise<void>[] = [];

      post.comments.forEach((comment) => {
        comment.replyComment.forEach((reply) => {
          userPromises.push(
            User.findOne({ _id: reply.userId }).then((user) => {
              if (user) {
                reply.userName = user.name;
                reply.userAvatar = user.avatarURL ?? undefined;
              }
            })
          );
        });
      });

      await Promise.all(userPromises);
    };

    await populateUserData();

    return res.status(200).json({ post });
  } catch (error) {
    console.error('[Post Details API]:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
