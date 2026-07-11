import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { getPublicSnapshot } from '@/src/services/llm-stats-snapshot';

// Public, unauthenticated read of the latest LLM-usage snapshot for the public
// dashboard page. Aggregate token/model/harness/cost data only — project names
// are stripped (getPublicSnapshot). GET only.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    await dbConnect();
    const snapshot = await getPublicSnapshot();
    // Short public cache: the snapshot only changes on a manual push.
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return ok(res, snapshot);
  } catch (error) {
    return sendError(res, error);
  }
}

// ~60/min per IP — matches the post feed; SWR/crawlers hit this too.
export default withRateLimit({ routeName: 'llm-stats.public', windowMs: 60_000, max: 60 })(handler);
