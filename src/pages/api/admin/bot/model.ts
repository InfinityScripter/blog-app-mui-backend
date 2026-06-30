import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { AppError } from '@/src/types/api';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { botControlService } from '@/src/services/bot-control';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Thin route: requireAuth(requireAdmin) → botControlService.setModel → respond.
// Admin auth is bearer-JWT (not cookie) so these POSTs are not CSRF-exposed.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  }
  try {
    const body = asRecord(req.body);
    const provider = typeof body.provider === 'string' ? body.provider : '';
    const model = typeof body.model === 'string' ? body.model : '';
    if (!provider || !model) {
      throw new AppError(HTTP.BAD_REQUEST, 'provider and model are required');
    }
    const result = await botControlService.setModel(provider, model);
    emitAudit(req, {
      action: 'bot.model_changed',
      targetType: 'bot',
      metadata: { provider, model },
    });
    return ok(res, result, { message: 'Модель обновлена' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
