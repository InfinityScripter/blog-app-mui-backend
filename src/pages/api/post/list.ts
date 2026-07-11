// src/pages/api/post/list.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { verifyToken } from '@/src/lib/jwt';
import { parseLang } from '@/src/constants/i18n';
import { sendError } from '@/src/utils/response';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { readCookie, ACCESS_COOKIE } from '@/src/lib/cookies';
import { translatePosts } from '@/src/services/post-translation';
import { postService, stripListContent } from '@/src/services/post';
import { MAX_LIMIT, DEFAULT_LIMIT } from '@/src/constants/pagination';

// Optional auth: a valid token scopes the list (admin → all, user → own);
// no/invalid token → published only. Logic lives in postService.listPosts.
//
// The token can arrive two ways (mirror require-auth's priority): a
// `Authorization: Bearer` header (legacy / service clients) OR the
// `access_token` httpOnly cookie the browser SPA sends after the cookie-auth
// migration. Reading only the header (as this did originally) meant a
// logged-in admin's cookie request fell through to the anonymous
// published-only branch — so the dashboard "Все посты" table never showed
// drafts or other users' posts.
function readAuth(req: NextApiRequest): { role?: string; userId?: string } {
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const token = bearerToken ?? readCookie(req, ACCESS_COOKIE);
  if (!token) return {};
  try {
    const decoded = verifyToken(token);
    return { role: decoded.role, userId: decoded.userId };
  } catch {
    return {};
  }
}

/** Parses a positive-integer query param, clamped to [min, max]; undefined if absent/invalid. */
function parsePositiveInt(raw: string | string[] | undefined, min: number, max: number) {
  if (typeof raw !== 'string') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || Number.isNaN(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    // i18n: translate the translatable fields of each post for a non-original
    // locale. `ru`/absent returns the posts untouched (byte-identical).
    const localized = await translatePosts(posts, parseLang(req.query.lang));

    // Strip the full content body from the wire payload (C7). Translation above
    // still needs it (source_hash + summary cache), so we drop it only now, at
    // the HTTP boundary; cards render from readingTime + description instead.
    const lean = stripListContent(localized);

    if (wantsPagination) {
      return res.status(HTTP.OK).json({ posts: lean, total, hasMore });
    }
    return res.status(HTTP.OK).json({ posts: lean });
  } catch (error) {
    return sendError(res, error);
  }
}

// ~60/min per IP — generous: SWR revalidates this feed frequently.
export default withRateLimit({ routeName: 'post.list', windowMs: 60_000, max: 60 })(handler);
