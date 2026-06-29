import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireDogsAdmin } from '@/src/utils/dogs-admin-auth';
import { dogsBookingService } from '@/src/services/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  try {
    const bookings = await dogsBookingService.listAdminBookings();
    return ok(res, { bookings });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireDogsAdmin(withMethods(['GET'])(handler));
