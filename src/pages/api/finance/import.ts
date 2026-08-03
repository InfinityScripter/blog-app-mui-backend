import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { financeService } from '@/src/services/finance';
import { validateBody } from '@/src/middlewares/validate';
import { financeImportSchema } from '@/src/schemas/finance';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { rejectBotToken } from '@/src/middlewares/reject-bot-token';

// Statements for a whole year are ~300 КБ, so the default 1 МБ JSON body limit
// is close; raise it once here instead of asking the client to chunk files.
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { csv, filename } = req.body as { csv: string; filename?: string };
    const result = await financeService.importCsv(csv);
    emitAudit(req, {
      action: 'finance.imported',
      targetType: 'finance_operations',
      targetId: filename ?? 'statement.csv',
      metadata: { ...result },
    });
    return ok(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export default rejectBotToken(
  requireAuth(
    requireAdmin(withMethods([HTTP_METHOD.POST])(validateBody(financeImportSchema)(handler)))
  )
);
