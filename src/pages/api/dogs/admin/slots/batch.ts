import type { NextApiRequest, NextApiResponse } from 'next';

import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/middlewares/validate';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { requireDogsAdmin } from '@/src/middlewares/require-dogs-admin';
import { createDogsSlotsBatchSchema } from '@/src/schemas/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const slots = await dogsBookingService.createSlots(req.body.slots);
    return ok(res, { slots }, { status: HTTP.CREATED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireDogsAdmin(
  withMethods([HTTP_METHOD.POST])(validateBody(createDogsSlotsBatchSchema)(handler))
);
