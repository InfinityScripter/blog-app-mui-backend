import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { calendarService } from '@/src/services/calendar';
import { requireAuth } from '@/src/middlewares/require-auth';

// Thin route: requireAuth → calendarService → respond. Keeps { success }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = req.user!._id;
  const isAdmin = req.user!.role === 'admin';
  const { id } = req.query as { id: string };

  try {
    if (req.method === HTTP_METHOD.DELETE) {
      await calendarService.deleteEvent({ eventId: id, userId, isAdmin });
      emitAudit(req, {
        action: 'calendar.event.deleted',
        targetType: 'calendar_event',
        targetId: id,
        metadata: { isAdmin },
      });
      return res.status(HTTP.OK).json({ success: true });
    }

    if (req.method === HTTP_METHOD.PATCH) {
      await calendarService.updateEvent({ eventId: id, userId, isAdmin }, req.body ?? {});
      emitAudit(req, {
        action: 'calendar.event.updated',
        targetType: 'calendar_event',
        targetId: id,
        metadata: { updatedFields: Object.keys(req.body ?? {}), isAdmin },
      });
      return res.status(HTTP.OK).json({ success: true });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
