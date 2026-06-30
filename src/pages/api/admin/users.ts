import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { sendError } from '@/src/utils/response';
import { adminService } from '@/src/services/admin';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// Thin route: requireAuth(requireAdmin) → adminService.listUsers → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  }
  try {
    const users = await adminService.listUsers();
    return res.status(HTTP.OK).json({ users });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
