import type { NextApiRequest, NextApiResponse } from 'next';

import { AppError } from '@/src/types/api';
import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { settingsService } from '@/src/services/settings';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Thin admin route: toggle the runtime pdCollection flag (personal-data
// collection master switch). requireAuth(requireAdmin) → settingsService.setFlag
// → audit → respond with the new state.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const body = asRecord(req.body);
    if (typeof body.enabled !== 'boolean') {
      throw new AppError(HTTP.BAD_REQUEST, 'enabled must be a boolean');
    }
    await settingsService.setFlag('pdCollection', body.enabled);
    emitAudit(req, {
      action: 'settings.pd_collection_toggled',
      targetType: 'setting',
      targetId: 'pdCollection',
      metadata: { enabled: body.enabled },
    });
    return ok(
      res,
      { pdCollection: body.enabled },
      {
        message: body.enabled
          ? 'Сбор персональных данных включён'
          : 'Сбор персональных данных выключен',
      }
    );
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
