import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { kanbanService } from '@/src/services/kanban';

// Thin route: requireAuth → kanbanService.deleteColumn → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { columnId } = req.query as { columnId: string };

  try {
    if (req.method === 'DELETE') {
      await kanbanService.deleteColumn(columnId);
      emitAudit(req, { action: 'kanban.column.deleted', targetType: 'column', targetId: columnId });
      return res.status(HTTP.OK).json({ success: true });
    }
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
