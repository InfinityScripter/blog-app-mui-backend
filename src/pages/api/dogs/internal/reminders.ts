import type { NextApiRequest, NextApiResponse } from 'next';

import { AppError } from '@/src/types/api';
import { safeEqual } from '@/src/utils/safe-equal';
import { ok, sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withMethods } from '@/src/middlewares/with-methods';
import { runDogsReminders } from '@/src/services/dogs-reminders';
import { armDogsReminderScheduler } from '@/src/services/dogs-reminder-scheduler';

// External trigger for the lesson reminder run (e.g. a cron on the frontend
// hosting). Safe to expose: the run is idempotent — every reminder is claimed
// atomically and sent at most once, so repeated/unauthorised calls can only
// re-check, never re-send. When DOGS_REMINDERS_SECRET is set the call must
// additionally carry it as a Bearer token.
armDogsReminderScheduler();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const secret = process.env.DOGS_REMINDERS_SECRET;
    if (secret && !safeEqual(req.headers.authorization ?? '', `Bearer ${secret}`)) {
      throw new AppError(HTTP.UNAUTHORIZED, 'Unauthorized');
    }

    const reminders = await runDogsReminders();
    return ok(res, { reminders });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withMethods([HTTP_METHOD.GET, HTTP_METHOD.POST])(handler);
