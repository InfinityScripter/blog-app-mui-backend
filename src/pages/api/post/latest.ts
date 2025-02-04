import type { NextApiRequest, NextApiResponse } from 'next';

import cors from 'src/utils/cors';
import { paramCase } from 'src/utils/change-case';

import { _posts } from 'src/_mock/_blog';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await cors(req, res);

    const { title } = req.query;

    const latestPosts = _posts.filter((_post) => paramCase(_post.title) !== title);

    if (!latestPosts.length) {
      res.status(404).json({
        message: 'Posts not found!',
      });
      return;
    }

    res.status(200).json({
      latestPosts,
    });
  } catch (error) {
    console.error('[Blog API]: ', error);
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}
