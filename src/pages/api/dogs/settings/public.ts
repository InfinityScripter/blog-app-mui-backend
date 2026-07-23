import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { settingsService } from '@/src/services/settings';

// Public, unauthenticated: the dogs-teacher frontend reads this to decide whether
// to render the booking form / CTA. Exposes ONLY dogsBooking — never pdCollection
// or any other flag (the blog's public route serves its own subset separately).
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const dogsBooking = await settingsService.getFlag('dogsBooking');
    return ok(res, { dogsBooking });
  } catch (error) {
    return sendError(res, error);
  }
}

export default handler;
