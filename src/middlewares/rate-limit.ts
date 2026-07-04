import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { getClientIp } from '@/src/utils/client-ip';

// ----------------------------------------------------------------------
// In-memory, per-IP fixed-window rate limiter. Composes like the other route
// middlewares (validateBody / withMethods): withRateLimit(opts)(handler).
//
// Buckets live in a module-scoped Map keyed by `${routeName}:${ip}` so each
// endpoint counts independently. The window resets lazily on the first request
// after resetAt, so there is no timer/interval to clean up.
//
// This process-local store does NOT coordinate across instances — it is a
// cheap, best-effort guard against bursts/abuse from a single IP on a single
// node, not a distributed quota. X-Forwarded-For is client-spoofable behind an
// untrusted proxy; nginx must forward it (see getClientIp).

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per IP within the window. */
  max: number;
  /** Per-endpoint bucket label so routes don't share a counter. */
  routeName: string;
  /**
   * Force the limiter on even under NODE_ENV==='test'. Off by default so jest
   * and Playwright e2e never trip the limit; the unit test flips it on to
   * exercise the real path.
   */
  enabledInTest?: boolean;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

// Expired buckets for one-off IPs would otherwise accumulate forever on the
// long-running `next start` process. Every SWEEP_INTERVAL requests we do a
// cheap O(map size) pass and evict buckets whose window has elapsed. Amortized
// this is negligible, and it never touches a still-active bucket.
export const SWEEP_INTERVAL = 500;
let requestsSinceSweep = 0;

/** Evicts buckets whose window has already elapsed (es5-safe: no delete-while-iterate). */
function sweepExpired(now: number) {
  const expiredKeys: string[] = [];
  store.forEach((bucket, key) => {
    if (now >= bucket.resetAt) {
      expiredKeys.push(key);
    }
  });
  expiredKeys.forEach((key) => store.delete(key));
}

/** Test-only: clears the shared bucket store and the sweep counter between cases. */
export function __resetRateLimitStore() {
  store.clear();
  requestsSinceSweep = 0;
}

/** Test-only: current number of buckets held in the store (to assert sweeping). */
export function __rateLimitStoreSize() {
  return store.size;
}

export function withRateLimit(opts: RateLimitOptions) {
  const { windowMs, max, routeName, enabledInTest = false } = opts;

  return (handler: NextApiHandler) => (req: NextApiRequest, res: NextApiResponse) => {
    // Gate off in tests unless explicitly enabled (mirror db.ts NODE_ENV check).
    if (process.env.NODE_ENV === 'test' && !enabledInTest) {
      return handler(req, res);
    }

    const key = `${routeName}:${getClientIp(req) ?? 'unknown'}`;
    const now = Date.now();

    requestsSinceSweep += 1;
    if (requestsSinceSweep >= SWEEP_INTERVAL) {
      requestsSinceSweep = 0;
      sweepExpired(now);
    }

    const bucket = store.get(key);

    if (!bucket || now >= bucket.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return handler(req, res);
    }

    if (bucket.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res
        .status(HTTP.TOO_MANY_REQUESTS)
        .json({ success: false, message: MSG.TOO_MANY_REQUESTS });
    }

    bucket.count += 1;
    return handler(req, res);
  };
}
