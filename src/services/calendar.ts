import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';

// Business logic for the calendar domain. No HTTP — throws AppError.

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  color: string;
  start_date: Date;
  end_date: Date;
  all_day: boolean;
  type: string;
  created_by: string;
}

/** Public events plus the user's own, ordered by start. */
async function listEvents(userId: string) {
  const result = await dbQuery<EventRow>(
    `SELECT id, title, description, color, start_date, end_date, all_day, type, created_by
     FROM calendar_events
     WHERE type = 'public' OR created_by = $1
     ORDER BY start_date ASC`,
    [userId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    color: r.color,
    start: r.start_date,
    end: r.end_date,
    allDay: r.all_day,
    type: r.type,
    createdBy: r.created_by,
  }));
}

interface CreateEventParams {
  userId: string;
  title: string;
  description?: string;
  color?: string;
  start: string;
  end: string;
  allDay?: boolean;
  type: string;
}

async function createEvent(params: CreateEventParams) {
  const {
    userId,
    title,
    description,
    color = 'primary',
    start,
    end,
    allDay = false,
    type,
  } = params;
  if (!title || !start || !end || !type) {
    throw new AppError(HTTP.BAD_REQUEST, 'title, start, end, type are required');
  }
  const id = uuidv4();
  await dbQuery(
    `INSERT INTO calendar_events
       (id, title, description, color, start_date, end_date, all_day, type, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, title, description ?? null, color, start, end, allDay, type, userId]
  );
  return { id, title, start, end, allDay, type, color };
}

export const calendarService = { listEvents, createEvent };
