import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

export const requireAdmin = (handler: NextApiHandler) =>
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: admin only' });
    }
    return handler(req, res);
  };
