import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { calendarService } from '@/src/services/calendar';

// Thin route: requireAuth → calendarService → respond. Keeps { success }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;
  const isAdmin = req.user!.role === 'admin';
  const { id } = req.query as { id: string };

  try {
    if (req.method === 'DELETE') {
      await calendarService.deleteEvent({ eventId: id, userId, isAdmin });
      return res.status(HTTP.OK).json({ success: true });
    }

    if (req.method === 'PATCH') {
      await calendarService.updateEvent({ eventId: id, userId, isAdmin }, req.body ?? {});
      return res.status(HTTP.OK).json({ success: true });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
