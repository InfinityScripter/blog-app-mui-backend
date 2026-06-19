import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

// Guards a handler to a set of HTTP methods; others get 405.
export function withMethods(methods: string[]) {
  return (handler: NextApiHandler) => (req: NextApiRequest, res: NextApiResponse) => {
    if (!req.method || !methods.includes(req.method)) {
      return res
        .status(HTTP.METHOD_NOT_ALLOWED)
        .json({ success: false, message: MSG.METHOD_NOT_ALLOWED });
    }
    return handler(req, res);
  };
}
