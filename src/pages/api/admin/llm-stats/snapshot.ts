import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { saveSnapshot, getLatestSnapshot } from '@/src/services/llm-stats-snapshot';

// Admin-only LLM-usage snapshot.
// GET  → latest snapshot ({ bundle, pushedAt } | { bundle: null }).
// POST → replace the snapshot with the pushed bundle (project names already
//        stripped client-side). requireAuth(requireAdmin) for both.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === HTTP_METHOD.GET) {
    try {
      const snapshot = await getLatestSnapshot();
      return ok(res, snapshot);
    } catch (error) {
      return sendError(res, error);
    }
  }

  if (req.method === HTTP_METHOD.POST) {
    try {
      const result = await saveSnapshot(req.body);
      emitAudit(req, {
        action: 'llm_stats.snapshot_pushed',
        targetType: 'llm_stats',
        metadata: { pushedAt: result.pushedAt },
      });
      return ok(res, result, { status: HTTP.CREATED, message: 'Снапшот сохранён' });
    } catch (error) {
      return sendError(res, error);
    }
  }

  return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
}

export default requireAuth(requireAdmin(handler));
