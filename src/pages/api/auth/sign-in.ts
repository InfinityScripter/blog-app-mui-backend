// src/pages/api/auth/sign-in.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP } from '@/src/constants/http';
import { sendError } from '@/src/utils/response';
import { signInSchema } from '@/src/schemas/auth';
import { authService } from '@/src/services/auth';
import { validateBody } from '@/src/utils/validate';
import { withMethods } from '@/src/middlewares/with-methods';

// Thin route: validate → service → respond. Logic lives in authService.
// Keeps the { accessToken, user } top-level keys the frontend reads.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  try {
    const { accessToken, user } = await authService.signIn(req.body);
    return res.status(HTTP.OK).json({ accessToken, user });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods(['POST'])(validateBody(signInSchema)(handler));
