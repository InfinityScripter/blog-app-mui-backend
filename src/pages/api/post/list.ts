// src/pages/api/post/list.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { verifyToken } from '@/src/lib/jwt';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { withRateLimit } from '@/src/utils/rate-limit';

// Optional auth: a valid token scopes the list (admin → all, user → own);
// no/invalid token → published only. Logic lives in postService.listPosts.
function readAuth(req: NextApiRequest): { role?: string; userId?: string } {
  const { authorization } = req.headers;
  if (!authorization) return {};
  try {
    const token = authorization.split(' ')[1];
    const decoded = verifyToken(token);
    return { role: decoded.role, userId: decoded.userId };
  } catch {
    return {};
  }
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Parses a positive-integer query param, clamped to [min, max]; undefined if absent/invalid. */
function parsePositiveInt(raw: string | string[] | undefined, min: number, max: number) {
  if (typeof raw !== 'string') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || Number.isNaN(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  try {
    await dbConnect();
    const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
    const excludeTag = typeof req.query.excludeTag === 'string' ? req.query.excludeTag : undefined;

    // Pagination is opt-in: present only when page or limit is supplied. The
    // default (no params) returns the full array — the FE relies on it for
    // generateStaticParams + sitemap, so it must stay complete.
    const wantsPagination =
      typeof req.query.page === 'string' || typeof req.query.limit === 'string';
    const page = wantsPagination
      ? (parsePositiveInt(req.query.page, 1, Number.MAX_SAFE_INTEGER) ?? 1)
      : undefined;
    const limit = wantsPagination
      ? (parsePositiveInt(req.query.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT)
      : undefined;

    const { posts, total, hasMore } = await postService.listPosts({
      ...readAuth(req),
      tag,
      excludeTag,
      page,
      limit,
    });

    if (wantsPagination) {
      return res.status(HTTP.OK).json({ posts, total, hasMore });
    }
    return res.status(HTTP.OK).json({ posts });
  } catch (error) {
    return sendError(res, error);
  }
}

// ~60/min per IP — generous: SWR revalidates this feed frequently.
export default withRateLimit({ routeName: 'post.list', windowMs: 60_000, max: 60 })(handler);
