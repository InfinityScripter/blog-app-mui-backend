import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { settingsService } from '@/src/services/settings';

// Public, unauthenticated: the frontend reads this to decide whether to render
// personal-data-collection UI (sign-up link, OAuth buttons, newsletter CTA). Only
// the flags that gate public UI are exposed — never any admin-only setting.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const pdCollection = await settingsService.getFlag('pdCollection');
    return ok(res, { pdCollection });
  } catch (error) {
    return sendError(res, error);
  }
}

export default handler;
