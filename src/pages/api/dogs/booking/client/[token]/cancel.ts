import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { sendDogsStatusChanged } from '@/src/utils/dogs-email';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { validateBody, validateQuery } from '@/src/utils/validate';
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
  await cors(req, res);

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

    return ok(res, { booking });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.PATCH])(
  validateQuery(dogsClientTokenQuerySchema)(validateBody(cancelDogsBookingRequestSchema)(handler))
);
