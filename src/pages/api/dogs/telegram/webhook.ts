import type { NextApiRequest, NextApiResponse } from 'next';

import { isAppError } from '@/src/types/api';
import { MSG } from '@/src/constants/messages';
import { safeEqual } from '@/src/utils/safe-equal';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withMethods } from '@/src/middlewares/with-methods';
import { handleDogsTelegramUpdate } from '@/src/services/dogs-telegram';

function hasValidSecret(req: NextApiRequest) {
  const expected = process.env.DOGS_TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    // FAILS CLOSED in production. An unset secret used to mean "accept
    // everything", so a deploy that forgot the env var served a fully open
    // update endpoint: a forged update can make the bot hand a client's private
    // portal link (view + cancel their bookings, name, phone) to any chat id
    // the caller names. Same posture as JWT_SECRET in lib/jwt.ts — refuse
    // rather than run unauthenticated. Dev/test keep the open path so the
    // webhook is callable without ceremony.
    if (process.env.NODE_ENV === 'production') {
      // eslint-disable-next-line no-console
      console.error(
        '[dogs telegram webhook] DOGS_TELEGRAM_WEBHOOK_SECRET is not set — rejecting every update. Set it and re-register the webhook with the same secret_token.'
      );
      return false;
    }
    return true;
  }
  const provided = req.headers['x-telegram-bot-api-secret-token'];
  // Constant-time compare — a plain === leaks the secret one byte at a time to
  // an attacker who can time repeated webhook probes.
  return typeof provided === 'string' && safeEqual(provided, expected);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!hasValidSecret(req)) {
    return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: MSG.UNAUTHORIZED });
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
