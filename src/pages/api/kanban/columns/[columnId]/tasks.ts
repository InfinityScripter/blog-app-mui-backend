import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { kanbanService } from '@/src/services/kanban';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';

// Thin route: requireAuth → kanbanService.addTask → respond. Keeps { task }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = req.user!._id;
  const { columnId } = req.query as { columnId: string };

  try {
    if (req.method !== HTTP_METHOD.POST) {
      return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
    }
    const { title, description, assignees, labels, dueDate } = req.body ?? {};
    const task = await kanbanService.addTask({
      columnId,
      userId,
      title,
      description,
      assignees,
      labels,
      dueDate,
    });
    emitAudit(req, {
      action: 'kanban.task.created',
      targetType: 'task',
      targetId: task.id,
      metadata: {
        columnId,
        assigneeCount: assignees?.length ?? 0,
        labelCount: labels?.length ?? 0,
        hasDueDate: Boolean(dueDate),
      },
    });
    return res.status(HTTP.CREATED).json({ task });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
