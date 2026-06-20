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
