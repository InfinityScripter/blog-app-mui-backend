import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

import { _products } from 'src/_mock/_product';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    res.status(HTTP.OK).json({
      products: _products,
    });
  } catch (error) {
    console.error('[Product API]: ', error);
    res.status(HTTP.INTERNAL).json({
      message: MSG.INTERNAL,
    });
  }
}
