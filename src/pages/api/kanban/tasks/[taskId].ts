import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { kanbanService } from '@/src/services/kanban';

// Thin route: requireAuth → kanbanService → respond. Keeps { success }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { taskId } = req.query as { taskId: string };

  try {
    if (req.method === 'DELETE') {
      await kanbanService.deleteTask(taskId);
      return res.status(HTTP.OK).json({ success: true });
    }

    if (req.method === 'PATCH') {
      await kanbanService.updateTask(taskId, req.body ?? {});
      return res.status(HTTP.OK).json({ success: true });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
