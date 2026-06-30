import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { sendError } from '@/src/utils/response';
import { adminService } from '@/src/services/admin';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// Thin route: requireAuth(requireAdmin) → adminService.deleteUser → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
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
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
