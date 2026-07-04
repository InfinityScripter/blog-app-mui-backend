import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsWebPushService } from '@/src/services/dogs-webpush';

// Public: the client fetches the VAPID public key to build a push subscription.
// publicKey is null until the key is configured, so the client can hide the UI.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    return ok(res, { publicKey: dogsWebPushService.getVapidPublicKey() });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.GET])(handler);
