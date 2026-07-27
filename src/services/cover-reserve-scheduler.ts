import { refillCoverReserve } from '@/src/services/cover-reserve';
import { isUnsplashConfigured } from '@/src/services/unsplash-cover';

// ----------------------------------------------------------------------
// In-process top-up of the Unsplash cover reserve. The backend is a single
// long-lived `next start` process on the VDS, so a plain interval is enough.
// Armed lazily via a side-effect import from the post-create route (the only
// traffic that drains the reserve) and guarded on globalThis so hot reloads and
// route re-imports never stack timers — the same shape as
// dogs-reminder-scheduler.ts.
//
// Nothing depends on this running: an empty reserve just means the next publish
// takes a static-pool cover, which is still unique and still instant.

const TICK_MS = 3 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 60 * 1000;

const globalForScheduler = globalThis as typeof globalThis & {
  __cover_reserve_scheduler__?: boolean;
};

function tick(trigger: string) {
  // Detached on purpose. refillCoverReserve swallows every Unsplash failure
  // itself; .catch is here for the DB half, so a failed tick can never surface
  // as an unhandled rejection and take the process down.
  refillCoverReserve()
    .then((result) => {
      if (result.added > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[cover-reserve] ${trigger}: stashed ${result.added} photos, depth ${result.depth}`
        );
      }
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[cover-reserve] refill failed', String(error));
    });
}

export function armCoverReserveScheduler() {
  if (
    process.env.NODE_ENV === 'test' ||
    !isUnsplashConfigured() ||
    globalForScheduler.__cover_reserve_scheduler__
  ) {
    return;
  }
  globalForScheduler.__cover_reserve_scheduler__ = true;

  // Top up shortly after boot (the reserve survives restarts in the DB, so this
  // usually finds it already full and makes zero requests), then steady ticks.
  // unref() keeps the timers from blocking a clean process shutdown.
  setTimeout(() => tick('boot'), BOOT_DELAY_MS).unref();
  setInterval(() => tick('interval'), TICK_MS).unref();
}
