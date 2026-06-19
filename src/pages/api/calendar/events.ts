import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { calendarService } from '@/src/services/calendar';

// Thin route: requireAuth → calendarService → respond. Keeps { events }/{ event }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;

  try {
    if (req.method === 'GET') {
      const events = await calendarService.listEvents(userId);
      return res.status(HTTP.OK).json({ events });
    }

    if (req.method === 'POST') {
      const event = await calendarService.createEvent({ userId, ...(req.body ?? {}) });
      return res.status(HTTP.CREATED).json({ event });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
