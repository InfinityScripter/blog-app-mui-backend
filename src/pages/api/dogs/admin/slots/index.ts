import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { validateBody } from '@/src/utils/validate';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireDogsAdmin } from '@/src/utils/dogs-admin-auth';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { createDogsSlotSchema } from '@/src/schemas/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

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
