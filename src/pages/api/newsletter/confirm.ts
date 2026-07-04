import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { validateQuery } from '@/src/middlewares/validate';
import { tokenQuerySchema } from '@/src/schemas/newsletter';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { withMethods } from '@/src/middlewares/with-methods';
import { subscriberService } from '@/src/services/subscriber';

// Public GET — confirm a pending subscription via the single-use confirm token.
// cors() first. 404 unknown token / 410 expired (mapped from AppError). Success
// returns ok() envelope: { success, data: { subscriber } } with status confirmed.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { token } = tokenQuerySchema.parse(req.query);
    const subscriber = await subscriberService.confirm(token);

    emitAudit(req, {
      action: 'newsletter.confirmed',
      targetType: 'subscriber',
      targetId: subscriber.id,
      metadata: { email: subscriber.email },
    });

    return ok(res, { subscriber });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withRateLimit({ routeName: 'newsletter.confirm', windowMs: 60_000, max: 20 })(
  withMethods([HTTP_METHOD.GET])(validateQuery(tokenQuerySchema)(handler))
);
