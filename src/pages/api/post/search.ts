// src/pages/api/post/search.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { verifyToken } from '@/src/lib/jwt';
import { parseLang } from '@/src/constants/i18n';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { readCookie, ACCESS_COOKIE } from '@/src/lib/cookies';
import { translatePosts } from '@/src/services/post-translation';

// Optional auth: dashboard=true searches the caller's own posts (token
// required), otherwise published only. Logic lives in postService.searchPosts.
// Token from the Bearer header (legacy/service) or the access_token httpOnly
// cookie the browser SPA sends (cookie-auth migration) — header-only would make
// dashboard search silently return published-only for a logged-in user.
function readUserId(req: NextApiRequest): string | undefined {
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const token = bearerToken ?? readCookie(req, ACCESS_COOKIE);
  if (!token) return undefined;
  try {
    return verifyToken(token).userId;
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
