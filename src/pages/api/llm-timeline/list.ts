import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { sendError } from '@/src/utils/response';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { llmTimelineModelService } from '@/src/services/llm-timeline-model';

// Public GET for the frontend SSR merge. Bare { models } like /api/changelog/list.
async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const models = await llmTimelineModelService.list();
    return res.status(HTTP.OK).json({ models });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withRateLimit({ routeName: 'llmTimeline.list', windowMs: 60_000, max: 60 })(handler);
