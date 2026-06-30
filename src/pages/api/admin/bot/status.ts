import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { botControlService } from '@/src/services/bot-control';

// Thin route: requireAuth(requireAdmin) → botControlService.getStatus → respond.
// Unreachable bot is surfaced as data.isAlive:false (a 200), never a 5xx, so the
// admin UI can render a "down" chip from a readable body.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  }
  try {
    const status = await botControlService.getStatus();
    return ok(res, status);
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
