import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { calendarService } from '@/src/services/calendar';
import { requireAuth } from '@/src/middlewares/require-auth';

// Thin route: requireAuth → calendarService → respond. Keeps { events }/{ event }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = req.user!._id;

  try {
    if (req.method === HTTP_METHOD.GET) {
      const events = await calendarService.listEvents(userId);
      return res.status(HTTP.OK).json({ events });
    }

    if (req.method === HTTP_METHOD.POST) {
      const event = await calendarService.createEvent({ userId, ...(req.body ?? {}) });
      emitAudit(req, {
        action: 'calendar.event.created',
        targetType: 'calendar_event',
        targetId: event.id,
        metadata: { type: event.type, allDay: event.allDay },
      });
      return res.status(HTTP.CREATED).json({ event });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
