import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { sendDogsStatusChanged } from '@/src/utils/dogs-email';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { dogsWebPushService } from '@/src/services/dogs-webpush';
import { validateBody, validateQuery } from '@/src/middlewares/validate';
import {
  dogsClientTokenQuerySchema,
  cancelDogsBookingRequestSchema,
} from '@/src/schemas/dogs-booking';
import {
  notifyDogsClientStatusChange,
  notifyDogsOwnerClientCancelled,
} from '@/src/services/dogs-telegram';

// Client-initiated cancel. The access token in the path is the auth — no admin
// session. cancelClientRequest enforces ownership and active status; here we
// just fire the three notifications non-blocking so a failing channel never
// breaks the response.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const booking = await dogsBookingService.cancelClientRequest(
      req.query.token as string,
      req.body.requestId
    );

    notifyDogsOwnerClientCancelled(booking).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[dogs-booking] owner cancel notification failed', String(error));
    });
    notifyDogsClientStatusChange(booking).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[dogs-booking] client Telegram notification failed', String(error));
    });
    sendDogsStatusChanged(booking.client, booking).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[dogs-booking] client email notification failed', String(error));
    });
    // Confirms the cancellation on the client's other subscribed devices too.
    dogsWebPushService.notifyClientStatusChange(booking).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[dogs-booking] client web-push notification failed', String(error));
    });

    return ok(res, { booking });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.PATCH])(
  validateQuery(dogsClientTokenQuerySchema)(validateBody(cancelDogsBookingRequestSchema)(handler))
);
