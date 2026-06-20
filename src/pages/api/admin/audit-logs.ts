import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { sendError } from '@/src/utils/response';
import { auditService } from '@/src/services/audit';

// Thin route: requireAuth(requireAdmin) → auditService.list → respond.
// GET /api/admin/audit-logs?action=&actorId=&targetType=&limit=&offset=
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'GET') {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
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
