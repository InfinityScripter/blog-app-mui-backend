import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { auditService } from '@/src/services/audit';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';

// Thin route: requireAuth(requireAdmin) → auditService.list → respond.
// GET /api/admin/audit-logs?action=&actorId=&targetType=&limit=&offset=
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const { action, actorId, targetType, limit, offset } = req.query;
    const result = await auditService.list({
      action: typeof action === 'string' ? action : undefined,
      actorId: typeof actorId === 'string' ? actorId : undefined,
      targetType: typeof targetType === 'string' ? targetType : undefined,
      limit: typeof limit === 'string' ? Number(limit) : undefined,
      offset: typeof offset === 'string' ? Number(offset) : undefined,
    });
    return res.status(HTTP.OK).json(result);
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
