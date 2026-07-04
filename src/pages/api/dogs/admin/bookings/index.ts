import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { requireDogsAdmin } from '@/src/middlewares/require-dogs-admin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const bookings = await dogsBookingService.listAdminBookings();
    return ok(res, { bookings });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireDogsAdmin(withMethods([HTTP_METHOD.GET])(handler));
