import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { requireDogsAdmin } from '@/src/middlewares/require-dogs-admin';
import { validateBody, validateQuery } from '@/src/middlewares/validate';
import { dogsIdQuerySchema, updateDogsSlotSchema } from '@/src/schemas/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === HTTP_METHOD.DELETE) {
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
  if (req.method === HTTP_METHOD.PATCH) {
    return validateBody(updateDogsSlotSchema)(handler)(req, res);
  }
  return handler(req, res);
}

export default requireDogsAdmin(
  withMethods([HTTP_METHOD.PATCH, HTTP_METHOD.DELETE])(
    validateQuery(dogsIdQuerySchema)(validatePatchOnly)
  )
);
