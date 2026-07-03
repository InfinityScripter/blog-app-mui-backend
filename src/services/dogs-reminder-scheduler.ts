import { runDogsReminders } from '@/src/services/dogs-reminders';

// ----------------------------------------------------------------------
// In-process reminder trigger. The backend is a single long-lived `next start`
// process on the VDS, so a plain interval is enough to tick the reminder
// service. It is armed lazily via a side-effect import from the dogs API
// routes (any real traffic arms it) and guarded on globalThis so hot reloads
// and route re-imports never stack timers. An external cron hitting
// /api/dogs/internal/reminders is a belt-and-braces second trigger — the
// atomic claim in dogs-reminders makes overlapping triggers safe.

const TICK_MS = 15 * 60 * 1000;
const BOOT_DELAY_MS = 45 * 1000;

const globalForScheduler = globalThis as typeof globalThis & {
  __dogs_reminder_scheduler__?: boolean;
};

function tick(trigger: string) {
  runDogsReminders()
    .then((result) => {
      if (result.sent > 0) {
        // eslint-disable-next-line no-console
        console.info(`[dogs-reminders] ${trigger}: sent ${result.sent}/${result.due} reminders`);
      }
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[dogs-reminders] run failed', String(error));
    });
}

export function armDogsReminderScheduler() {
  if (process.env.NODE_ENV === 'test' || globalForScheduler.__dogs_reminder_scheduler__) {
    return;
  }
  globalForScheduler.__dogs_reminder_scheduler__ = true;

  // Catch up shortly after boot (covers reminders that came due while the
  // process was down), then steady 15-minute ticks. unref() keeps the timers
  // from blocking a clean process shutdown.
  setTimeout(() => tick('boot'), BOOT_DELAY_MS).unref();
  setInterval(() => tick('interval'), TICK_MS).unref();
}
