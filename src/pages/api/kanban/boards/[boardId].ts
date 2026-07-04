import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { kanbanService } from '@/src/services/kanban';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';

// Thin route: requireAuth → kanbanService → respond. Keeps { board }/{ success }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = req.user!._id;
  const { boardId } = req.query as { boardId: string };

  try {
    if (req.method === HTTP_METHOD.DELETE) {
      await kanbanService.deleteBoard(boardId);
      emitAudit(req, { action: 'kanban.board.deleted', targetType: 'board', targetId: boardId });
      return res.status(HTTP.OK).json({ success: true });
    }

    if (req.method === HTTP_METHOD.GET) {
      const board = await kanbanService.getBoard(userId, boardId);
      return res.status(HTTP.OK).json({ board });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
