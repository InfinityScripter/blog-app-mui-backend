import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { settingsService } from '@/src/services/settings';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { validateBodyByMethod } from '@/src/middlewares/validate';
import { pdCollectionToggleSchema } from '@/src/schemas/admin-settings';

// Thin admin route: toggle the runtime pdCollection flag (personal-data
// collection master switch). requireAuth(requireAdmin) → settingsService.setFlag
// → audit → respond with the new state.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const { body } = req;
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

export default requireAuth(
  requireAdmin(validateBodyByMethod({ [HTTP_METHOD.POST]: pdCollectionToggleSchema })(handler))
);
