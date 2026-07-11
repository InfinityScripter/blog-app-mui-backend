import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { validateBody } from '@/src/middlewares/validate';
import { withMethods } from '@/src/middlewares/with-methods';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { dogsAdminLoginSchema } from '@/src/schemas/dogs-booking';
import { createDogsAdminToken } from '@/src/middlewares/require-dogs-admin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const token = createDogsAdminToken(req.body.password);
    return ok(res, { token });
  } catch (error) {
    return sendError(res, error);
  }
}

// 5/min per IP — single-password admin login is a brute-force target.
export default withRateLimit({ routeName: 'dogs.admin.login', windowMs: 60_000, max: 5 })(
  withMethods([HTTP_METHOD.POST])(validateBody(dogsAdminLoginSchema)(handler))
);
