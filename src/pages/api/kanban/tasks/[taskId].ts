import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { kanbanService } from '@/src/services/kanban';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';

// Thin route: requireAuth → kanbanService → respond. Keeps { success }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { taskId } = req.query as { taskId: string };

  try {
    if (req.method === HTTP_METHOD.DELETE) {
      await kanbanService.deleteTask(taskId);
      emitAudit(req, { action: 'kanban.task.deleted', targetType: 'task', targetId: taskId });
      return res.status(HTTP.OK).json({ success: true });
    }

    if (req.method === HTTP_METHOD.PATCH) {
      const body = req.body ?? {};
      await kanbanService.updateTask(taskId, body);
      // A move changes column/position; everything else is a field edit.
      const isMove =
        body.columnId !== undefined || body.column_id !== undefined || body.position !== undefined;
      emitAudit(req, {
        action: isMove ? 'kanban.task.moved' : 'kanban.task.updated',
        targetType: 'task',
        targetId: taskId,
        metadata: {
          fields: Object.keys(body),
          ...(isMove
            ? { toColumnId: body.columnId ?? body.column_id, position: body.position }
            : {}),
        },
      });
      return res.status(HTTP.OK).json({ success: true });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
