import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { FEATURES } from '@/src/config-global';
import { sendConfirmEmail } from '@/src/utils/email';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/middlewares/validate';
import { subscribeSchema } from '@/src/schemas/newsletter';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { withMethods } from '@/src/middlewares/with-methods';
import { subscriberService } from '@/src/services/subscriber';
import { requireFeature } from '@/src/middlewares/require-feature';

// Public POST — double-opt-in subscribe. Body is validated by
// validateBody(subscribeSchema). On success returns 201 ok() envelope; the bot
// / frontend read data.data.subscriber. Success is returned only after the mail
// provider accepts the confirmation message. A failed delivery leaves the row
// pending; the user can retry and receive a fresh token.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { email } = req.body;
    const { subscriber, confirmToken } = await subscriberService.subscribe(email);

    await sendConfirmEmail(email, confirmToken);

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

export default requireFeature(FEATURES.pdCollection)(
  withRateLimit({
    routeName: 'newsletter.subscribe',
    windowMs: 60_000,
    max: 5,
    enabledInTest: true,
  })(withMethods([HTTP_METHOD.POST])(validateBody(subscribeSchema)(handler)))
);
