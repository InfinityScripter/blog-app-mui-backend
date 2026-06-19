// src/pages/api/post/list.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { verifyToken } from '@/src/lib/jwt';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';

// Optional auth: a valid token scopes the list (admin → all, user → own);
// no/invalid token → published only. Logic lives in postService.listPosts.
function readAuth(req: NextApiRequest): { role?: string; userId?: string } {
  const { authorization } = req.headers;
  if (!authorization) return {};
  try {
    const token = authorization.split(' ')[1];
    const decoded = verifyToken(token);
    return { role: decoded.role, userId: decoded.userId };
  } catch {
    return {};
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  try {
    await dbConnect();
    const posts = await postService.listPosts(readAuth(req));
    return res.status(HTTP.OK).json({ posts });
  } catch (error) {
    return sendError(res, error);
  }
}

export default handler;
