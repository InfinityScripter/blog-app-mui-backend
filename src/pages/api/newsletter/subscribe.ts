import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import dbConnect from '@/src/lib/db';
import { validateBody } from '@/src/utils/validate';
import { sendConfirmEmail } from '@/src/utils/email';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { withRateLimit } from '@/src/utils/rate-limit';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { subscribeSchema } from '@/src/schemas/newsletter';
import { withMethods } from '@/src/middlewares/with-methods';
import { subscriberService } from '@/src/services/subscriber';

// Public POST — double-opt-in subscribe. cors() first. Body is validated by
// validateBody(subscribeSchema). On success returns 201 ok() envelope; the bot
// / frontend read data.data.subscriber. The confirm email is fire-and-forget:
// a mail failure must NOT lose the subscriber (the DB write already succeeded),
// only a DB write failure surfaces as an error.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  try {
    await dbConnect();
    const { email } = req.body;
    const { subscriber, confirmToken } = await subscriberService.subscribe(email);

    sendConfirmEmail(email, confirmToken).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[newsletter.subscribe] confirm email failed', error);
    });

    emitAudit(req, {
      action: 'newsletter.subscribed',
      targetType: 'subscriber',
      targetId: subscriber.id,
      metadata: { email },
    });

    return ok(res, { subscriber }, { status: HTTP.CREATED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withRateLimit({
  routeName: 'newsletter.subscribe',
  windowMs: 60_000,
  max: 5,
  enabledInTest: true,
})(withMethods([HTTP_METHOD.POST])(validateBody(subscribeSchema)(handler)));
