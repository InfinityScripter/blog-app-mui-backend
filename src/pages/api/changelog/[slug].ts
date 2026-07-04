import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { validateQuery } from '@/src/middlewares/validate';
import { withMethods } from '@/src/middlewares/with-methods';
import { slugParamSchema } from '@/src/schemas/model-release';
import { modelReleaseService } from '@/src/services/model-release';

// Public GET by slug — no auth. ok() envelope: { success, data: { release } }.
// 404 (AppError NOT_FOUND) when the slug is unknown.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { slug } = slugParamSchema.parse(req.query);
    const release = await modelReleaseService.getBySlug(slug);
    return ok(res, { release });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.GET])(validateQuery(slugParamSchema)(handler));
