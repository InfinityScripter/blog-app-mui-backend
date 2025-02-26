import type { NextApiRequest, NextApiResponse } from 'next';

import User from '@/src/models/User';

import dbConnect from 'src/lib/db';
import { Post } from 'src/models/Post';

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

    // Находим пост и увеличиваем счетчик просмотров атомарно
    const post = await Post.findOneAndUpdate(
      { _id: id },
      { $inc: { totalViews: 1 } },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    post.totalComments = post.comments.length;
    await post.save();
    // Populate user data for reply comments
    const populateUserData = async () => {
      const userPromises: Promise<void>[] = [];

      post.comments.forEach((comment) => {
        comment.replyComment.forEach((reply) => {
          userPromises.push(
            User.findOne({ _id: reply.userId }).then((user) => {
              if (user) {
                reply.userName = user.name;
                reply.userAvatar = user.avatarURL;
              }
            })
          );
        });
      });

      await Promise.all(userPromises);
    };

    await populateUserData();

    res.status(200).json({ post });
  } catch (error) {
    console.error('[Post Details API]:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
