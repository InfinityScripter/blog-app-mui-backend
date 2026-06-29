import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { ok, sendError } from '@/src/utils/response';
import { validateQuery } from '@/src/utils/validate';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { dogsClientTokenQuerySchema } from '@/src/schemas/dogs-booking';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  try {
    const portal = await dogsBookingService.getClientPortal(req.query.token as string);
    return ok(res, portal);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods(['GET'])(validateQuery(dogsClientTokenQuerySchema)(handler));
