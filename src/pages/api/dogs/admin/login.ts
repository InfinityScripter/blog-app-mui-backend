import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/utils/validate';
import { ok, sendError } from '@/src/utils/response';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsAdminLoginSchema } from '@/src/schemas/dogs-booking';
import { createDogsAdminToken } from '@/src/utils/dogs-admin-auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  try {
    const token = createDogsAdminToken(req.body.password);
    return ok(res, { token });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.POST])(validateBody(dogsAdminLoginSchema)(handler));
