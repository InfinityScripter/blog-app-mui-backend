import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { validateQuery } from '@/src/utils/validate';
import { emitAudit } from '@/src/utils/audit-context';
import { withRateLimit } from '@/src/utils/rate-limit';
import { tokenQuerySchema } from '@/src/schemas/newsletter';
import { withMethods } from '@/src/middlewares/with-methods';
import { subscriberService } from '@/src/services/subscriber';

// Public GET — unsubscribe via the permanent unsubscribe token. cors() first.
// 404 unknown token; idempotent (already-unsubscribed token still returns 200).
// Success returns ok() envelope: { success, data: { email, status } }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  try {
    await dbConnect();
    const { token } = tokenQuerySchema.parse(req.query);
    const { email } = await subscriberService.unsubscribe(token);

    emitAudit(req, {
      action: 'newsletter.unsubscribed',
      targetType: 'subscriber',
      metadata: { email },
    });

    return ok(res, { email, status: 'unsubscribed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withRateLimit({ routeName: 'newsletter.unsubscribe', windowMs: 60_000, max: 20 })(
  withMethods([HTTP_METHOD.GET])(validateQuery(tokenQuerySchema)(handler))
);
