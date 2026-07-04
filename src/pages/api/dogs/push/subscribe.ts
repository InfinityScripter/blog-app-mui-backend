import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { validateBody } from '@/src/middlewares/validate';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsWebPushService } from '@/src/services/dogs-webpush';
import { dogsPushSubscribeSchema } from '@/src/schemas/dogs-booking';

// Public: the access token in the body is the auth (same model as the booking
// client routes). Stores the browser's push subscription for the client.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const result = await dogsWebPushService.saveSubscription(
      req.body.accessToken,
      req.body.subscription
    );
    return ok(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.POST])(validateBody(dogsPushSubscribeSchema)(handler));
