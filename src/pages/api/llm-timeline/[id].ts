import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { requireFeature } from '@/src/middlewares/require-feature';
import { validateBody, validateQuery } from '@/src/middlewares/validate';
import { llmTimelineModelService } from '@/src/services/llm-timeline-model';
import {
  llmTimelineIdParamSchema,
  upsertLlmTimelineModelSchema,
} from '@/src/schemas/llm-timeline-model';

// Bot-token/admin PUT: the ai-changelog-watcher job publishes one timeline
// entry per call and re-PUTs to fix it. Gated by autoPublishTimeline so the
// admin can stop the job without touching the Mac it runs on.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { id } = llmTimelineIdParamSchema.parse(req.query);
    const { model, created } = await llmTimelineModelService.upsert(id, req.body);
    emitAudit(req, {
      action: created ? 'llm_timeline_model.created' : 'llm_timeline_model.updated',
      targetType: 'llm_timeline_model',
      targetId: model.id,
      metadata: { vendor: model.vendor, name: model.name, releaseDate: model.releaseDate },
    });
    return ok(res, { model, created }, { status: created ? HTTP.CREATED : HTTP.OK });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireFeature('autoPublishTimeline', { enabledInTest: true })(
  requireAuth(
    requireAdmin(
      withMethods([HTTP_METHOD.PUT])(
        validateQuery(llmTimelineIdParamSchema)(validateBody(upsertLlmTimelineModelSchema)(handler))
      )
    )
  )
);
