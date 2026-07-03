import { dogsDbQuery } from '@/src/lib/dogs-db';
import { sendDogsReminder } from '@/src/utils/dogs-email';
import { dogsWebPushService } from '@/src/services/dogs-webpush';
import { dogsBookingService } from '@/src/services/dogs-booking';
import { notifyDogsClientReminder } from '@/src/services/dogs-telegram';

// ----------------------------------------------------------------------
// Lesson reminders. The booking form promises «Пришлём подтверждение и
// напоминание о занятии» — this service delivers the second half: every
// confirmed request whose slot starts within the next REMINDER_WINDOW_HOURS
// gets exactly one reminder across email + Telegram + web push.
//
// At-most-once is enforced by an atomic per-row claim on
// dogs_booking_requests.reminder_sent_at (UPDATE ... WHERE reminder_sent_at IS
// NULL RETURNING), so overlapping triggers (in-process interval, the internal
// endpoint hit by an external cron, several server instances) can never send
// duplicates. Channel failures are logged and never re-claimed — a broken
// channel must not spam the working ones on retry.

const REMINDER_WINDOW_HOURS = 30;

interface DueRow {
  id: string;
}

async function findDueRequestIds(now: Date) {
  const from = now.toISOString();
  const to = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const result = await dogsDbQuery<DueRow>(
    `SELECT r.id
     FROM dogs_booking_requests r
     JOIN dogs_booking_slots s ON s.id = r.slot_id
     WHERE r.status = 'confirmed'
       AND r.reminder_sent_at IS NULL
       AND s.starts_at > $1
       AND s.starts_at <= $2
     ORDER BY s.starts_at ASC`,
    [from, to]
  );
  return result.rows.map((row) => row.id);
}

// Atomic claim: only the caller that flips reminder_sent_at from NULL wins the
// right to send. Everyone else sees zero rows and skips.
async function claimRequest(requestId: string) {
  const result = await dogsDbQuery<DueRow>(
    `UPDATE dogs_booking_requests
     SET reminder_sent_at = NOW()
     WHERE id = $1 AND reminder_sent_at IS NULL
     RETURNING id`,
    [requestId]
  );
  return Boolean(result.rows[0]);
}

export interface DogsRemindersRunResult {
  due: number;
  sent: number;
}

// Claims one due request and fans the reminder out to every channel. Returns
// whether this caller actually owned (and sent) the reminder.
async function remindOne(requestId: string) {
  const claimed = await claimRequest(requestId);
  if (!claimed) {
    return false;
  }

  const request = await dogsBookingService.getRequestDetails(requestId).catch(() => null);
  if (!request) {
    return false;
  }

  const outcomes = await Promise.allSettled([
    sendDogsReminder(request.client, request),
    notifyDogsClientReminder(request),
    dogsWebPushService.notifyClientReminder(request),
  ]);
  outcomes.forEach((outcome) => {
    if (outcome.status === 'rejected') {
      // eslint-disable-next-line no-console
      console.warn('[dogs-reminders] reminder channel failed', String(outcome.reason));
    }
  });

  return true;
}

export async function runDogsReminders(now: Date = new Date()): Promise<DogsRemindersRunResult> {
  const dueIds = await findDueRequestIds(now);
  const results = await Promise.all(dueIds.map(remindOne));
  return { due: dueIds.length, sent: results.filter(Boolean).length };
}
