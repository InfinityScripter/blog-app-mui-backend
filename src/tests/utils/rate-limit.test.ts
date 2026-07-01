import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import {
  withRateLimit,
  SWEEP_INTERVAL,
  __rateLimitStoreSize,
  __resetRateLimitStore,
} from '@/src/utils/rate-limit';

// The limiter is gated OFF under NODE_ENV==='test' so route e2e never trips.
// These unit tests force it on via enabledInTest to exercise the real path.
const OPTS = {
  routeName: 'test.route',
  windowMs: 60_000,
  max: 2,
  enabledInTest: true,
} as const;

function request(ip = '1.2.3.4') {
  return createMocks({
    method: HTTP_METHOD.GET,
    headers: { 'x-forwarded-for': ip },
  });
}

describe('withRateLimit middleware', () => {
  beforeEach(() => {
    __resetRateLimitStore();
  });

  // Restore real timers here (not in beforeEach): the global setup's own
  // beforeEach runs a DB reset that hangs under fake timers, and it executes
  // before this suite's beforeEach on the next test.
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows up to max requests, then 429 on the (max+1)th without calling the handler', async () => {
    const handler = jest.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = withRateLimit(OPTS)(handler as any);

    // First two (max=2) pass through.
    const a = request();
    await wrapped(a.req as any, a.res as any);
    const b = request();
    await wrapped(b.req as any, b.res as any);
    expect(handler).toHaveBeenCalledTimes(2);

    // Third is blocked.
    const c = request();
    await wrapped(c.req as any, c.res as any);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(c.res._getStatusCode()).toBe(429);
    const data = JSON.parse(c.res._getData());
    expect(data.success).toBe(false);
    expect(data.message).toBe('Too many requests, please try again later.');
    expect(c.res.getHeader('Retry-After')).toBeDefined();
  });

  it('separate IPs get independent buckets', async () => {
    const handler = jest.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = withRateLimit(OPTS)(handler as any);

    const a1 = request('10.0.0.1');
    await wrapped(a1.req as any, a1.res as any);
    const a2 = request('10.0.0.1');
    await wrapped(a2.req as any, a2.res as any);
    const a3 = request('10.0.0.1');
    await wrapped(a3.req as any, a3.res as any);
    expect(a3.res._getStatusCode()).toBe(429);

    // Different IP still has a fresh bucket.
    const b1 = request('10.0.0.2');
    await wrapped(b1.req as any, b1.res as any);
    expect(b1.res._getStatusCode()).toBe(200);
  });

  it('resets after the window elapses (fake timers)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);

    const handler = jest.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = withRateLimit(OPTS)(handler as any);

    const a = request();
    await wrapped(a.req as any, a.res as any);
    const b = request();
    await wrapped(b.req as any, b.res as any);
    const c = request();
    await wrapped(c.req as any, c.res as any);
    expect(c.res._getStatusCode()).toBe(429);

    // Advance past the window — the bucket resets lazily on the next request.
    jest.setSystemTime(OPTS.windowMs + 1);
    const d = request();
    await wrapped(d.req as any, d.res as any);
    expect(d.res._getStatusCode()).toBe(200);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('sweeps expired buckets at the sweep threshold while active ones survive', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);

    // A generous limit so the many active-IP requests below never 429 —
    // we only care about store bookkeeping here.
    const opts = { ...OPTS, max: SWEEP_INTERVAL } as const;
    const handler = jest.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = withRateLimit(opts)(handler as any);

    // Seed one bucket for a one-off IP (request #1, resetAt = windowMs).
    const seed = request('9.9.9.9');
    await wrapped(seed.req as any, seed.res as any);
    expect(__rateLimitStoreSize()).toBe(1);

    // Advance past the window so the seeded bucket is now expired.
    jest.setSystemTime(OPTS.windowMs + 1);

    // Fire SWEEP_INTERVAL-1 requests from an active IP. The last of these makes
    // the running counter reach SWEEP_INTERVAL and triggers the sweep.
    const activeIp = '1.1.1.1';
    await Array.from({ length: SWEEP_INTERVAL - 1 }).reduce(async (prev) => {
      await prev;
      const r = request(activeIp);
      await wrapped(r.req as any, r.res as any);
    }, Promise.resolve());

    // Expired '9.9.9.9' was evicted; the active '1.1.1.1' bucket survives.
    expect(__rateLimitStoreSize()).toBe(1);
  });

  it('is gated off under NODE_ENV=test without enabledInTest (never throttles)', async () => {
    const handler = jest.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = withRateLimit({ routeName: 'gated', windowMs: 60_000, max: 1 })(handler as any);

    const a = request();
    await wrapped(a.req as any, a.res as any);
    const b = request();
    await wrapped(b.req as any, b.res as any);
    const c = request();
    await wrapped(c.req as any, c.res as any);
    // All pass — limiter disabled in the test env.
    expect(handler).toHaveBeenCalledTimes(3);
    expect(c.res._getStatusCode()).toBe(200);
  });
});
