import type { NextApiRequest, NextApiResponse } from 'next';

import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withMethods } from '@/src/middlewares/with-methods';
import { handleDogsTelegramUpdate } from '@/src/services/dogs-telegram';

function hasValidSecret(req: NextApiRequest) {
  const expected = process.env.DOGS_TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    return true;
  }
  return req.headers['x-telegram-bot-api-secret-token'] === expected;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!hasValidSecret(req)) {
    return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: 'Unauthorized' });
  }

  try {
    await handleDogsTelegramUpdate(req.body ?? {});
    return ok(res);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.POST])(handler);
