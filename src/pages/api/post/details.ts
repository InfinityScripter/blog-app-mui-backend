import type { NextApiRequest, NextApiResponse } from 'next';

import User from '@/src/models/User';
import { MSG } from '@/src/constants/messages';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

import dbConnect from 'src/lib/db';
import { Post } from 'src/models/Post';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();
    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid post id' });
    }

    // Pure read. View counting lives in POST /api/post/[id]/view so that SSR
    // prerenders and SWR revalidations don't inflate the counter.
    const post = await Post.findById(id);

    if (!post) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'Post not found' });
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

    return res.status(HTTP.OK).json({ post });
  } catch (error) {
    console.error('[Post Details API]:', error);
    return res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL });
  }
}
