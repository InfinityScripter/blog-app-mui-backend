import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { ok, sendError } from '@/src/utils/response';
import { validateQuery } from '@/src/utils/validate';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { dogsSlotsQuerySchema } from '@/src/schemas/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  try {
    const slots = await dogsBookingService.listAvailableSlots(req.query);
    return ok(res, { slots });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods(['GET'])(validateQuery(dogsSlotsQuerySchema)(handler));
