import type { NextApiRequest } from 'next';

/**
 * Best-effort client IP for audit logging.
 *
 * Behind nginx on the VDS, req.socket.remoteAddress is the proxy loopback, so
 * the real client IP only survives if nginx forwards X-Forwarded-For/X-Real-IP.
 * We read the first comma-separated entry of X-Forwarded-For, then X-Real-IP,
 * then fall back to the socket. Returns null if nothing resolves.
 *
 * NOTE: X-Forwarded-For is client-spoofable unless injected by a trusted proxy,
 * so this value is for audit context only — never gate security on it.
 */
export function getClientIp(req: NextApiRequest): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
    if (first) {
      return first;
    }
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return req.socket?.remoteAddress ?? null;
}

/**
 * Number of trusted reverse-proxy hops in front of this app, each of which
 * APPENDS the peer IP to X-Forwarded-For (nginx's $proxy_add_x_forwarded_for).
 * Default 1 = a single trusted nginx. Set TRUSTED_PROXY_HOPS to match the deploy.
 */
const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1) || 1);

/**
 * Client IP for SECURITY decisions (rate-limit bucketing). Unlike getClientIp
 * (best-effort, reads the leftmost/attacker-controlled X-Forwarded-For entry),
 * this reads the entry the LAST trusted proxy appended: with N appending hops
 * the real client is at chain[length - N] (the Nth from the right). Anything to
 * its LEFT is client-supplied and ignored, so a client can't mint fresh
 * rate-limit buckets by prepending spoofed entries. Falls back to X-Real-IP
 * (set by nginx) then the socket peer. Rate-limit keys must never use getClientIp.
 */
export function getTrustedClientIp(req: NextApiRequest): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (chain.length > 0) {
      // Nth-from-the-right (N = trusted hops). Clamp to the leftmost so a chain
      // shorter than the hop count can't index off the front.
      const idx = Math.max(0, chain.length - TRUSTED_PROXY_HOPS);
      return chain[idx] ?? null;
    }
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return req.socket?.remoteAddress ?? null;
}
