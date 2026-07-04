import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';

export const requireAdmin =
  (handler: NextApiHandler) => async (req: NextApiRequest, res: NextApiResponse) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'Forbidden: admin only' });
    }
    return handler(req, res);
  };
