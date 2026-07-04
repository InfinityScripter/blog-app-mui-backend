import type { NextApiRequest, NextApiResponse } from 'next';

import { AppError } from '@/src/types/api';
import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { botControlService } from '@/src/services/bot-control';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Thin route: requireAuth(requireAdmin) → botControlService.setMock → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const body = asRecord(req.body);
    if (typeof body.enabled !== 'boolean') {
      throw new AppError(HTTP.BAD_REQUEST, 'enabled must be a boolean');
    }
    const result = await botControlService.setMock(body.enabled);
    emitAudit(req, {
      action: 'bot.mock_toggled',
      targetType: 'bot',
      metadata: { enabled: body.enabled },
    });
    return ok(res, result, { message: body.enabled ? 'Mock включён' : 'Mock выключен' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
