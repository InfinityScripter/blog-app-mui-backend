import type { NextApiRequest, NextApiResponse } from 'next';

import cors from 'src/utils/cors';

import { _posts } from 'src/_mock/_blog';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await cors(req, res);

    res.status(200).json({
      posts: _posts,
    });
  } catch (error) {
    console.error('[Blog API]: ', error);
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}
