// src/pages/api/post/latest.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { parseLang } from '@/src/constants/i18n';
import { paramCase } from '@/src/utils/change-case';
import { translatePosts } from '@/src/services/post-translation';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { title } = req.query;
    if (!title || typeof title !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Query parameter "title" is required.' });
    }
    const posts = await Post.find({}).sort({ createdAt: -1 }).lean();
    // Filter on the ORIGINAL title slug (the FE passes the ru-derived slug for
    // every locale — see the contract: the query runs against the original).
    const latestPosts = posts.filter((p) => paramCase(p.title) !== title);
    if (latestPosts.length === 0) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'Posts not found!' });
    }
    // i18n: translate the returned posts for a non-original locale.
    const localized = await translatePosts(latestPosts, parseLang(req.query.lang));
    res.status(HTTP.OK).json({ latestPosts: localized });
  } catch (error: any) {
    console.error('[Post Latest API]: ', error);
    res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL });
  }
}
