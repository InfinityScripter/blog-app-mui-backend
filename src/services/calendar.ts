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

/** Loads an event and asserts the user may modify it (owner or admin). */
async function assertCanModify(eventId: string, userId: string, isAdmin: boolean) {
  const result = await dbQuery<{ created_by: string }>(
    'SELECT created_by FROM calendar_events WHERE id = $1',
    [eventId]
  );
  if (!result.rows[0]) {
    throw new AppError(HTTP.NOT_FOUND, 'Event not found');
  }
  if (result.rows[0].created_by !== userId && !isAdmin) {
    throw new AppError(HTTP.FORBIDDEN, 'Forbidden');
  }
}

interface ModifyParams {
  eventId: string;
  userId: string;
  isAdmin: boolean;
}

/** Deletes an event the user owns (or any event if admin). */
async function deleteEvent({ eventId, userId, isAdmin }: ModifyParams) {
  await assertCanModify(eventId, userId, isAdmin);
  await dbQuery('DELETE FROM calendar_events WHERE id = $1', [eventId]);
}

const EVENT_COLUMN_MAP: Record<string, string> = {
  title: 'title',
  description: 'description',
  color: 'color',
  start: 'start_date',
  end: 'end_date',
  allDay: 'all_day',
  type: 'type',
};

/** Partial event update (owner or admin); only provided fields are written. */
async function updateEvent(
  { eventId, userId, isAdmin }: ModifyParams,
  patch: Record<string, unknown>
) {
  await assertCanModify(eventId, userId, isAdmin);
  const updates: string[] = [];
  const values: unknown[] = [];
  Object.entries(EVENT_COLUMN_MAP).forEach(([key, column]) => {
    if (patch[key] !== undefined) {
      values.push(patch[key]);
      updates.push(`${column} = $${values.length}`);
    }
  });
  if (!updates.length) {
    throw new AppError(HTTP.BAD_REQUEST, 'No fields to update');
  }
  updates.push('updated_at = NOW()');
  values.push(eventId);
  await dbQuery(
    `UPDATE calendar_events SET ${updates.join(', ')} WHERE id = $${values.length}`,
    values
  );
}

export const calendarService = { listEvents, createEvent, deleteEvent, updateEvent };
