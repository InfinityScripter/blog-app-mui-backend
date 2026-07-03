import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { validateQuery } from '@/src/utils/validate';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { dogsSlotsQuerySchema } from '@/src/schemas/dogs-booking';
import { armDogsReminderScheduler } from '@/src/services/dogs-reminder-scheduler';

// Highest-traffic dogs route (every booking page load) — arms the in-process
// lesson reminder scheduler as a side effect of normal traffic.
armDogsReminderScheduler();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  try {
    const slots = await dogsBookingService.listAvailableSlots(req.query);
    return ok(res, { slots });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.GET])(validateQuery(dogsSlotsQuerySchema)(handler));
