import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { kanbanService } from '@/src/services/kanban';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// Thin route: requireAuth → kanbanService → respond. Keeps { boards }/{ board }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;

  try {
    if (req.method === HTTP_METHOD.GET) {
      const boards = await kanbanService.listBoards(userId);
      return res.status(HTTP.OK).json({ boards });
    }

    if (req.method === HTTP_METHOD.POST) {
      const { name, description, memberIds } = req.body ?? {};
      const board = await kanbanService.createBoard({
        userId,
        role: req.user!.role,
        name,
        description,
        memberIds,
      });
      emitAudit(req, {
        action: 'kanban.board.created',
        targetType: 'board',
        targetId: board.id,
        metadata: { memberCount: memberIds?.length ?? 0 },
      });
      return res.status(HTTP.CREATED).json({ board });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
