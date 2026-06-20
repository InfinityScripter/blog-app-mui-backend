import type { NextApiRequest } from 'next';
import type { AuditContext } from '@/src/services/audit';

import uuidv4 from '@/src/utils/uuidv4';
import { getClientIp } from '@/src/utils/client-ip';

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
