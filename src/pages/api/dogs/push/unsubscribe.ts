import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { validateBody } from '@/src/middlewares/validate';
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

export default withMethods([HTTP_METHOD.POST])(validateBody(dogsPushUnsubscribeSchema)(handler));
