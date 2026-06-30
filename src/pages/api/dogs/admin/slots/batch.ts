import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { validateBody } from '@/src/utils/validate';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireDogsAdmin } from '@/src/utils/dogs-admin-auth';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { createDogsSlotsBatchSchema } from '@/src/schemas/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

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
