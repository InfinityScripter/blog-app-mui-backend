import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { validateQuery } from '@/src/middlewares/validate';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { llmTimelineIdParamSchema } from '@/src/schemas/llm-timeline-model';
import { llmTimelineModelService } from '@/src/services/llm-timeline-model';

// Retracting a wrong entry must work even when publishing is switched off, so
// no requireFeature here.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { id } = llmTimelineIdParamSchema.parse(req.query);
    await llmTimelineModelService.remove(id);
    emitAudit(req, {
      action: 'llm_timeline_model.deleted',
      targetType: 'llm_timeline_model',
      targetId: id,
    });
    return ok(res, { id });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(
  requireAdmin(withMethods([HTTP_METHOD.DELETE])(validateQuery(llmTimelineIdParamSchema)(handler)))
);
