import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { financeService } from '@/src/services/finance';
import { validateQuery } from '@/src/middlewares/validate';
import { financeRangeSchema } from '@/src/schemas/finance';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { rejectBotToken } from '@/src/middlewares/reject-bot-token';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { from, to } = req.query as { from?: string; to?: string };
    const summary = await financeService.getSummary(from, to);
    return ok(res, summary);
  } catch (error) {
    return sendError(res, error);
  }
}

export default rejectBotToken(
  requireAuth(
    requireAdmin(withMethods([HTTP_METHOD.GET])(validateQuery(financeRangeSchema)(handler)))
  )
);
