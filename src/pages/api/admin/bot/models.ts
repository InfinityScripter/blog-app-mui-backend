import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { ok, sendError } from '@/src/utils/response';
import { botControlService } from '@/src/services/bot-control';

// Thin route: requireAuth(requireAdmin) → botControlService.listModels → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'GET') {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  }
  try {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : '';
    if (!provider) throw new AppError(HTTP.BAD_REQUEST, 'provider is required');
    const models = await botControlService.listModels(provider);
    return ok(res, { provider, models });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
