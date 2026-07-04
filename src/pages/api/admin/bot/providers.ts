import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { botControlService } from '@/src/services/bot-control';

// Thin route: requireAuth(requireAdmin) → botControlService.listProviders → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const providers = await botControlService.listProviders();
    return ok(res, { providers });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
