import type { NextApiRequest, NextApiResponse } from 'next';

import { isAppError } from '@/src/types/api';
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
    // Telegram redelivers the same update on ANY non-2xx response. A handled
    // business error (4xx AppError) must therefore be acknowledged with 200 —
    // only genuine failures (unexpected errors, 5xx) keep an error status so
    // transient problems get retried.
    if (isAppError(error) && error.status < HTTP.INTERNAL) {
      // eslint-disable-next-line no-console
      console.warn('[dogs telegram webhook] handled business error:', error.message);
      return ok(res);
    }
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.POST])(handler);
