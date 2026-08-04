import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { financeService } from '@/src/services/finance';
import { validateQuery } from '@/src/middlewares/validate';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { financeOperationsSchema } from '@/src/schemas/finance';
import { rejectBotToken } from '@/src/middlewares/reject-bot-token';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { bucket, from, to } = req.query as { bucket: string; from?: string; to?: string };
    const operations = await financeService.getBucketOperations(bucket, from, to);
    return ok(res, { operations });
  } catch (error) {
    return sendError(res, error);
  }
}

export default rejectBotToken(
  requireAuth(
    requireAdmin(withMethods([HTTP_METHOD.GET])(validateQuery(financeOperationsSchema)(handler)))
  )
);
