import type { NextApiRequest, NextApiResponse } from 'next';

import cors from 'src/utils/cors';

import { _navItems } from 'src/_mock/_navbar';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await cors(req, res);

    res.status(200).json({
      navItems: _navItems,
    });
  } catch (error) {
    console.error('[Nav API]: ', error);
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}
