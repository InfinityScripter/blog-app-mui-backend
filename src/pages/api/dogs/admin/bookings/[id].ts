import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireDogsAdmin } from '@/src/utils/dogs-admin-auth';
import { sendDogsStatusChanged } from '@/src/utils/dogs-email';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { validateBody, validateQuery } from '@/src/utils/validate';
import { notifyDogsClientStatusChange } from '@/src/services/dogs-telegram';
import { dogsIdQuerySchema, updateDogsBookingStatusSchema } from '@/src/schemas/dogs-booking';

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const booking = await dogsBookingService.updateBookingStatus(
    req.query.id as string,
    req.body.status
  );
  notifyDogsClientStatusChange(booking).catch((error) => {
    // eslint-disable-next-line no-console
    console.warn('[dogs-booking] client Telegram notification failed', String(error));
  });
  sendDogsStatusChanged(booking.client, booking).catch((error) => {
    // eslint-disable-next-line no-console
    console.warn('[dogs-booking] client email notification failed', String(error));
  });
  return ok(res, { booking });
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  await dogsBookingService.deleteRequest(req.query.id as string);
  return ok(res, undefined, { message: 'Booking request deleted' });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  try {
    if (req.method === 'DELETE') {
      return await handleDelete(req, res);
    }
    return await handlePatch(req, res);
  } catch (error) {
    return sendError(res, error);
  }
}

async function validatePatchOnly(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'PATCH') {
    return validateBody(updateDogsBookingStatusSchema)(handler)(req, res);
  }
  return handler(req, res);
}

export default requireDogsAdmin(
  withMethods(['PATCH', 'DELETE'])(validateQuery(dogsIdQuerySchema)(validatePatchOnly))
);
