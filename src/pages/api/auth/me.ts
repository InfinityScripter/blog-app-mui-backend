// src/pages/api/auth/me.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '../../../lib/db';
import User from '../../../models/User';
import { requireAuth } from '../../../utils/auth';
import { toPublicUser } from '../../../utils/public-user';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    await dbConnect();
    const user = await User.findById(req.user!._id);
    if (!user) {
      return res.status(401).json({ message: 'Invalid authorization token' });
    }
    return res.status(200).json({ user: toPublicUser(user) });
  } catch (error: any) {
    console.error('[Me API]', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export default requireAuth(handler);
