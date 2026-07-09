// src/pages/api/post/latest.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP } from '@/src/constants/http';
import { sendError } from '@/src/utils/response';
import { parseLang } from '@/src/constants/i18n';
import { postService } from '@/src/services/post';
import { translatePosts } from '@/src/services/post-translation';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { title } = req.query;
    if (!title || typeof title !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Query parameter "title" is required.' });
    }
    // Newest PUBLISHED posts, excluding the current one by its ORIGINAL title
    // slug (the FE passes the ru-derived slug for every locale). Bounded in SQL
    // — no full-table scan, and drafts are never exposed here.
    const latestPosts = await postService.findLatestPublished(title);
    if (latestPosts.length === 0) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'Posts not found!' });
    }
    // i18n: translate the returned posts for a non-original locale.
    const localized = await translatePosts(latestPosts, parseLang(req.query.lang));
    res.status(HTTP.OK).json({ latestPosts: localized });
  } catch (error) {
    return sendError(res, error);
  }
}
