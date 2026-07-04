import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { kanbanService } from '@/src/services/kanban';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';

// Thin route: requireAuth → kanbanService.deleteColumn → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { columnId } = req.query as { columnId: string };

  try {
    if (req.method === HTTP_METHOD.DELETE) {
      await kanbanService.deleteColumn(columnId);
      emitAudit(req, { action: 'kanban.column.deleted', targetType: 'column', targetId: columnId });
      return res.status(HTTP.OK).json({ success: true });
    }
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
