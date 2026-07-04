import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withRateLimit } from '@/src/middlewares/rate-limit';

// Public POST endpoint: bumps a post's view counter atomically. Called once
// per reader from the client (deduped via localStorage there). Kept out of the
// details GET so SSR/ISR prerenders and SWR revalidations don't inflate views.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();
    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid post id' });
    }

    // Intentionally NOT audited: views are high-volume (every reader, every
    // page load) and would flood the audit trail with noise. The total_views
    // counter on the post is the source of truth for this signal.
    const totalViews = await postService.incrementViews(id);
    if (totalViews === null) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'Post not found' });
    }

    return res.status(HTTP.OK).json({ message: 'View counted', totalViews });
  } catch (error) {
    return sendError(res, error);
  }
}

// ~30/min per IP — one view per reader is deduped client-side; this caps abuse.
export default withRateLimit({ routeName: 'post.view', windowMs: 60_000, max: 30 })(handler);
