// src/pages/api/auth/me.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { MSG } from '@/src/constants/messages';
import { toPublicUser } from '@/src/utils/public-user';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    await dbConnect();
    const user = await User.findById(req.user!._id);
    if (!user) {
      return res.status(HTTP.UNAUTHORIZED).json({ message: 'Invalid authorization token' });
    }
    return res.status(HTTP.OK).json({ user: toPublicUser(user) });
  } catch (error: any) {
    console.error('[Me API]', error);
    return res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL });
  }
}

export default requireAuth(handler);
