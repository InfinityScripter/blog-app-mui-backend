import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { fail } from '@/src/utils/response';

// requireAuth resolves a Bearer BOT_API_TOKEN into the owner's admin user so
// the news bot can publish posts. That transitive grant must NOT extend to
// the finance ledger: a leaked bot token would read the whole bank history.
// Same isolation idea as the dogs auth domain (requireDogsAdmin) — here the
// service token is rejected outright before requireAuth even sees it.
export function rejectBotToken(handler: NextApiHandler) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const botToken = process.env.BOT_API_TOKEN;
    if (botToken && req.headers.authorization === `Bearer ${botToken}`) {
      return fail(res, HTTP.FORBIDDEN, 'Forbidden: service token');
    }
    return handler(req, res);
  };
}
