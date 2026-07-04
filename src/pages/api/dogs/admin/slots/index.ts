import type { NextApiRequest, NextApiResponse } from 'next';

import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/middlewares/validate';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { createDogsSlotSchema } from '@/src/schemas/dogs-booking';
import { requireDogsAdmin } from '@/src/middlewares/require-dogs-admin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === HTTP_METHOD.GET) {
      const slots = await dogsBookingService.listAdminSlots();
      return ok(res, { slots });
    }

    const slot = await dogsBookingService.createSlot(req.body);
    return ok(res, { slot }, { status: HTTP.CREATED });
  } catch (error) {
    return sendError(res, error);
  }
}

async function validatePostOnly(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === HTTP_METHOD.POST) {
    return validateBody(createDogsSlotSchema)(handler)(req, res);
  }
  return handler(req, res);
}

export default requireDogsAdmin(withMethods([HTTP_METHOD.GET, HTTP_METHOD.POST])(validatePostOnly));
