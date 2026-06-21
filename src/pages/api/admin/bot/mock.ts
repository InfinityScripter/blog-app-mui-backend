import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { ok, sendError } from '@/src/utils/response';
import { botControlService } from '@/src/services/bot-control';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Thin route: requireAuth(requireAdmin) → botControlService.setMock → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'POST') {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  }
  try {
    const body = asRecord(req.body);
    if (typeof body.enabled !== 'boolean') {
      throw new AppError(HTTP.BAD_REQUEST, 'enabled must be a boolean');
    }
    const result = await botControlService.setMock(body.enabled);
    return ok(res, result, { message: body.enabled ? 'Mock включён' : 'Mock выключен' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
