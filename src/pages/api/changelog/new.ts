import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/middlewares/validate';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { modelReleaseService } from '@/src/services/model-release';
import { createModelReleaseSchema } from '@/src/schemas/model-release';

// Admin/bot-only POST. Bot auth is the requireAuth freebie (Bearer BOT_API_TOKEN
// → OWNER_EMAIL admin). Responds 201 with ok() envelope — the bot reads
// data.data.release.id and expects HTTP 201.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const release = await modelReleaseService.create(req.body);
    emitAudit(req, {
      action: 'model_release.created',
      targetType: 'model_release',
      targetId: release.id,
      metadata: {
        vendor: release.vendor,
        model: release.model,
        version: release.version,
        slug: release.slug,
      },
    });
    return ok(res, { release }, { status: HTTP.CREATED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(
  requireAdmin(withMethods([HTTP_METHOD.POST])(validateBody(createModelReleaseSchema)(handler)))
);
