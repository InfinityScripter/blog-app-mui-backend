import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

import { _labels } from 'src/_mock/_mail';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    res.status(HTTP.OK).json({
      labels: _labels,
    });
  } catch (error) {
    console.error('[Mail API]: ', error);
    res.status(HTTP.INTERNAL).json({
      message: MSG.INTERNAL,
    });
  }
}
