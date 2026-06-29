import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireDogsAdmin } from '@/src/utils/dogs-admin-auth';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { validateBody, validateQuery } from '@/src/utils/validate';
import { dogsIdQuerySchema, updateDogsSlotSchema } from '@/src/schemas/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  try {
    const slot = await dogsBookingService.updateSlot(req.query.id as string, req.body);
    return ok(res, { slot });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireDogsAdmin(
  withMethods(['PATCH'])(
    validateQuery(dogsIdQuerySchema)(validateBody(updateDogsSlotSchema)(handler))
  )
);
