import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { sendError } from '@/src/utils/response';
import { postService } from '@/src/services/post';
import { withRateLimit } from '@/src/utils/rate-limit';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// Public POST endpoint: bumps a post's view counter atomically. Called once
// per reader from the client (deduped via localStorage there). Kept out of the
// details GET so SSR/ISR prerenders and SWR revalidations don't inflate views.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
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
