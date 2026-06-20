import type { NextApiRequest } from 'next';

import uuidv4 from '@/src/utils/uuidv4';
import { getClientIp } from '@/src/utils/client-ip';
import { auditService, type AuditRecord, type AuditContext } from '@/src/services/audit';

/**
 * Builds the actor + request context for an audit record from the request.
 * Safe on anonymous routes (no req.user) — actorId/actorRole come back null.
 * requestId uses req.requestId if a wrapper stashed one, else mints a fresh uuid.
 */
export function buildAuditContext(req: NextApiRequest): AuditContext {
  return {
    actorId: req.user?._id ?? null,
    actorRole: req.user?.role ?? null,
    ip: getClientIp(req),
    requestId: (req as NextApiRequest & { requestId?: string }).requestId ?? uuidv4(),
  };
}

/**
 * One-liner for route handlers: capture the request context and emit an audit
 * event in a single fire-and-forget call. Call it on the success path only.
 * Fields from the request context (actorId/actorRole/ip/requestId) can be
 * overridden — e.g. sign-in derives the actor from the looked-up user, not req.
 */
export function emitAudit(req: NextApiRequest, event: AuditRecord): void {
  auditService.record({ ...buildAuditContext(req), ...event });
}
