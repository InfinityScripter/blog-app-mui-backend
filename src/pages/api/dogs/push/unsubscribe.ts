import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { validateBody } from '@/src/middlewares/validate';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsWebPushService } from '@/src/services/dogs-webpush';
import { dogsPushUnsubscribeSchema } from '@/src/schemas/dogs-booking';

// Public: drops the client's push subscription for the given endpoint. The
// access token scopes the delete to the caller's own subscriptions.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const result = await dogsWebPushService.deleteSubscription(
      req.body.accessToken,
      req.body.endpoint
    );
    return ok(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

// Same guessing surface as subscribe — the access token in the body is the auth.
export default withRateLimit({ routeName: 'dogs.push.unsubscribe', windowMs: 60_000, max: 10 })(
  withMethods([HTTP_METHOD.POST])(validateBody(dogsPushUnsubscribeSchema)(handler))
);
