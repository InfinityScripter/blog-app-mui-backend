import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { ok, sendError } from '@/src/utils/response';
import { financeService } from '@/src/services/finance';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { validateQuery } from '@/src/middlewares/validate';
import { financeExportSchema } from '@/src/schemas/finance';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { rejectBotToken } from '@/src/middlewares/reject-bot-token';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { from, to, format } = req.query as {
      from?: string;
      to?: string;
      format?: 'csv' | 'json';
    };
    const operations = await financeService.getExport(from, to);
    if (format === 'json') {
      return ok(res, { operations });
    }
    const filename = `finance-${from ?? 'all'}-${to ?? 'all'}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    // BOM keeps Excel from mangling the UTF-8 Cyrillic headers.
    return res.status(HTTP.OK).send(`\uFEFF${financeService.toCsv(operations)}`);
  } catch (error) {
    return sendError(res, error);
  }
}

export default rejectBotToken(
  requireAuth(
    requireAdmin(withMethods([HTTP_METHOD.GET])(validateQuery(financeExportSchema)(handler)))
  )
);
