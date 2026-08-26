import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { settingsService } from '@/src/services/settings';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { validateBodyByMethod } from '@/src/middlewares/validate';
import { autoPublishToggleSchema } from '@/src/schemas/admin-settings';

// Thin admin route: toggle one of the news-bot auto-publish flags. One keyed
// route (body { key, enabled }) rather than two near-identical handlers, since
// the only difference is which flag is set. The schema's key enum is the
// allow-list — this route can never flip an unrelated flag like pdCollection.
// requireAuth(requireAdmin) → settingsService.setFlag → audit → respond.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const body = req.body as { key: 'autoPublishReleases' | 'autoPublishNews'; enabled: boolean };
    await settingsService.setFlag(body.key, body.enabled);
    emitAudit(req, {
      action: 'settings.auto_publish_toggled',
      targetType: 'setting',
      targetId: body.key,
      metadata: { enabled: body.enabled },
    });
    return ok(
      res,
      { [body.key]: body.enabled },
      {
        message: body.enabled ? 'Автопубликация включена' : 'Автопубликация выключена',
      }
    );
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(
  requireAdmin(validateBodyByMethod({ [HTTP_METHOD.POST]: autoPublishToggleSchema })(handler))
);
