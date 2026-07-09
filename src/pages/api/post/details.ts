import type { NextApiRequest, NextApiResponse } from 'next';

import User from '@/src/models/User';
import dbConnect from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { parseLang } from '@/src/constants/i18n';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { getTranslatedPostFields } from '@/src/services/post-translation';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();
    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid post id' });
    }

    // Pure read. View counting lives in POST /api/post/[id]/view so that SSR
    // prerenders and SWR revalidations don't inflate the counter.
    const post = await Post.findById(id);

    if (!post) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'Post not found' });
    }

    post.totalComments = post.comments.length;

    // Populate author name/avatar on every reply. Batch the user lookups into a
    // single query (was an N+1 loop of findOne per reply) and key by id.
    const replies = post.comments.flatMap((comment) => comment.replyComment);
    if (replies.length > 0) {
      const authors = await User.findByIds(replies.map((reply) => reply.userId));
      const authorById = new Map(authors.map((author) => [String(author._id), author]));
      replies.forEach((reply) => {
        const author = authorById.get(String(reply.userId));
        if (author) {
          reply.userName = author.name;
          reply.userAvatar = author.avatarURL ?? undefined;
        }
      });
    }

    // i18n: for a non-original locale, replace only the translatable fields
    // (title/description/content). Everything else — id, comments, author,
    // counts, meta_* — stays exactly as-is. `ru`/absent is a no-op (original).
    const lang = parseLang(req.query.lang);
    const translated = await getTranslatedPostFields(post, lang);
    post.title = translated.title;
    post.description = translated.description;
    post.content = translated.content;

    return res.status(HTTP.OK).json({ post });
  } catch (error) {
    // Consistent with the other post routes: map AppError status/message and
    // hide internals, instead of flattening everything to a generic 500.
    return sendError(res, error);
  }
}
