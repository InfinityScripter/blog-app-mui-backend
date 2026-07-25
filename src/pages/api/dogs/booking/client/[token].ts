import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { validateQuery } from '@/src/middlewares/validate';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { dogsClientTokenQuerySchema } from '@/src/schemas/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const portal = await dogsBookingService.getClientPortal(req.query.token as string);
    return ok(res, portal);
  } catch (error) {
    return sendError(res, error);
  }
}

// The path token IS the auth here, and a hit returns the client's name, phone
// and lesson history — so this is a guessing surface and gets the same
// treatment as the other token-in-URL routes (newsletter confirm/unsubscribe).
export default withRateLimit({ routeName: 'dogs.booking.client', windowMs: 60_000, max: 20 })(
  withMethods([HTTP_METHOD.GET])(validateQuery(dogsClientTokenQuerySchema)(handler))
);
