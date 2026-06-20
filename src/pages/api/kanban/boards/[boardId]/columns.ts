import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { kanbanService } from '@/src/services/kanban';

// Thin route: requireAuth → kanbanService.addColumn → respond. Keeps { column }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { boardId } = req.query as { boardId: string };

  try {
    if (req.method !== 'POST') {
      return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
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
