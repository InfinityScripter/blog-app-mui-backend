import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { kanbanService } from '@/src/services/kanban';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';

// Thin route: requireAuth → kanbanService.addColumn → respond. Keeps { column }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { boardId } = req.query as { boardId: string };

  try {
    if (req.method !== HTTP_METHOD.POST) {
      return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
    }
    const column = await kanbanService.addColumn(boardId, req.body?.name);
    emitAudit(req, {
      action: 'kanban.column.created',
      targetType: 'column',
      targetId: column.id,
      metadata: { boardId, position: column.position },
    });
    return res.status(HTTP.CREATED).json({ column });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
