import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { validateBody } from '@/src/utils/validate';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withMethods } from '@/src/middlewares/with-methods';
import { sendDogsRequestReceived } from '@/src/utils/dogs-email';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { createDogsBookingRequestSchema } from '@/src/schemas/dogs-booking';
import { armDogsReminderScheduler } from '@/src/services/dogs-reminder-scheduler';
import {
  notifyDogsOwnerNewRequest,
  notifyDogsClientRequestReceived,
} from '@/src/services/dogs-telegram';

armDogsReminderScheduler();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  try {
    const request = await dogsBookingService.createRequest(req.body);
    notifyDogsOwnerNewRequest(request).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[dogs-booking] owner Telegram notification failed', String(error));
    });
    notifyDogsClientRequestReceived(request).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[dogs-booking] client Telegram notification failed', String(error));
    });
    sendDogsRequestReceived(request.client, request).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[dogs-booking] client email notification failed', String(error));
    });
    return ok(res, { request }, { status: HTTP.CREATED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.POST])(
  validateBody(createDogsBookingRequestSchema)(handler)
);
