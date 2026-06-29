import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP } from '@/src/constants/http';
import { validateBody } from '@/src/utils/validate';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { notifyDogsOwnerNewRequest } from '@/src/services/dogs-telegram';
import { createDogsBookingRequestSchema } from '@/src/schemas/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  try {
    const request = await dogsBookingService.createRequest(req.body);
    notifyDogsOwnerNewRequest(request).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[dogs-booking] owner Telegram notification failed', String(error));
    });
    return ok(res, { request }, { status: HTTP.CREATED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods(['POST'])(validateBody(createDogsBookingRequestSchema)(handler));
