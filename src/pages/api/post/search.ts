// src/pages/api/post/search.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { verifyToken } from '@/src/lib/jwt';
import { parseLang } from '@/src/constants/i18n';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { translatePosts } from '@/src/services/post-translation';

// Optional auth: dashboard=true searches the caller's own posts (token
// required), otherwise published only. Logic lives in postService.searchPosts.
function readUserId(req: NextApiRequest): string | undefined {
  const { authorization } = req.headers;
  if (!authorization) return undefined;
  try {
    return verifyToken(authorization.split(' ')[1]).userId;
  } catch {
    return undefined;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { query, dashboard } = req.query;
    const results = await postService.searchPosts({
      query: typeof query === 'string' ? query : undefined,
      dashboard: dashboard === 'true',
      userId: readUserId(req),
    });
    // Search matches on the original title; results are translated for a
    // non-original locale. `ru`/absent returns them untouched.
    const localized = await translatePosts(results, parseLang(req.query.lang));
    return res.status(HTTP.OK).json({ results: localized });
  } catch (error) {
    return sendError(res, error);
  }
}

// ~30/min per IP — search is user-typed, so a moderate cap is plenty.
export default withRateLimit({ routeName: 'post.search', windowMs: 60_000, max: 30 })(handler);
