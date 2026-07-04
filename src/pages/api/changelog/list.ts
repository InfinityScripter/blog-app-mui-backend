import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { sendError } from '@/src/utils/response';
import { validateQuery } from '@/src/middlewares/validate';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { modelReleaseService } from '@/src/services/model-release';
import { listModelReleasesQuerySchema } from '@/src/schemas/model-release';

// Public GET — no auth. Returns a BARE { releases, total } (like { posts }) so
// the frontend and bot read the array directly. Query is validated + coerced by
// validateQuery(listModelReleasesQuerySchema), so req.query is already typed.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const query = listModelReleasesQuerySchema.parse(req.query);
    const { releases, total } = await modelReleaseService.list(query);
    return res.status(HTTP.OK).json({ releases, total });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withRateLimit({ routeName: 'changelog.list', windowMs: 60_000, max: 60 })(
  validateQuery(listModelReleasesQuerySchema)(handler)
);
