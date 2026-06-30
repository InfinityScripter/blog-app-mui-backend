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
    if (req.method === 'DELETE') {
      await dogsBookingService.deleteSlot(req.query.id as string);
      return ok(res, undefined, { message: 'Slot deleted' });
    }

    const slot = await dogsBookingService.updateSlot(req.query.id as string, req.body);
    return ok(res, { slot });
  } catch (error) {
    return sendError(res, error);
  }
}

async function validatePatchOnly(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'PATCH') {
    return validateBody(updateDogsSlotSchema)(handler)(req, res);
  }
  return handler(req, res);
}

export default requireDogsAdmin(
  withMethods(['PATCH', 'DELETE'])(validateQuery(dogsIdQuerySchema)(validatePatchOnly))
);
