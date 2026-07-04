import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { collectSystemMetrics } from '@/src/services/system-metrics';

// Admin-only live server metrics: CPU / memory / disk / host / process / DB.
// GET /api/admin/system-metrics
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const metrics = await collectSystemMetrics();
    return ok(res, metrics);
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
