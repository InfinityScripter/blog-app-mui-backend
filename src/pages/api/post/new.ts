import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { withMethods } from '@/src/middlewares/with-methods';
import { warmPostTranslations } from '@/src/services/translation-warmup';

// Thin route: requireAuth → postService.createPost → respond.
// Keeps the { post } key the frontend reads.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const post = await postService.createPost(req.user!._id, req.body);
    emitAudit(req, {
      action: 'post.created',
      targetType: 'post',
      targetId: post.id,
      metadata: {
        publish: post.publish,
        tagCount: post.tags?.length ?? 0,
        hasCover: Boolean(post.coverUrl),
      },
    });
    // Fire-and-forget: warm this post's feed-title translation so an EN visitor
    // sees a translated title without the feed paying a per-request DeepL call.
    // Only for a published post (drafts aren't in any public feed). Deliberately
    // not awaited — must not delay or fail the create response; warmPostSummary
    // swallows provider errors internally.
    if (post.publish === 'published') {
      // Not awaited — the returned promise is intentionally detached so the warm
      // runs after the response. .catch keeps an async rejection from becoming
      // an unhandled rejection.
      warmPostTranslations({
        id: post.id,
        title: post.title,
        description: post.description,
        content: post.content,
      }).catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[post/new] background translation warm failed', post.id, error);
      });
    }

    return res.status(HTTP.CREATED).json({ message: 'Пост успешно создан', success: true, post });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(withMethods([HTTP_METHOD.POST])(handler));
