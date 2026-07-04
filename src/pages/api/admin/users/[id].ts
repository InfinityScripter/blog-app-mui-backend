import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { adminService } from '@/src/services/admin';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';

// Thin route: requireAuth(requireAdmin) → adminService.deleteUser → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query as { id: string };

  try {
    if (req.method === HTTP_METHOD.DELETE) {
      await adminService.deleteUser(req.user!._id, id);
      emitAudit(req, {
        action: 'user.deleted',
        targetType: 'user',
        targetId: id,
        metadata: { deletedByAdminId: req.user!._id },
      });
      return res.status(HTTP.OK).json({ success: true, message: 'User deleted' });
    }
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
