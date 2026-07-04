import type { NextApiRequest, NextApiResponse } from 'next';

import { AppError } from '@/src/types/api';
import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';

// Audit events the bot is allowed to forge. Anything outside this set is
// rejected (400) so a compromised BOT_API_TOKEN can't write arbitrary audit
// rows. All entries carry the `bot.` prefix; keep the list tight.
const ALLOWED_BOT_ACTIONS = [
  'bot.relevance_dropped',
  'bot.relevance_shadow_dropped',
  'bot.relevance_kept',
] as const;

type AllowedBotAction = (typeof ALLOWED_BOT_ACTIONS)[number];

// Cap on the serialized metadata size — defends the table against a buggy bot
// flooding a single row with a huge payload.
const MAX_METADATA_CHARS = 4000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isAllowedBotAction(action: string): action is AllowedBotAction {
  return (ALLOWED_BOT_ACTIONS as readonly string[]).includes(action);
}

// Thin route: requireAuth(requireAdmin) → validate → emitAudit → respond.
// The bot reaches this via BOT_API_TOKEN (resolveBotUser maps it to the owner
// admin), so the same admin-only guard covers both the bot and human admins.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const body = asRecord(req.body);

    const action = typeof body.action === 'string' ? body.action : '';
    if (!action || !isAllowedBotAction(action)) {
      throw new AppError(HTTP.BAD_REQUEST, 'action is required and must be an allowed bot event');
    }

    const targetType = typeof body.targetType === 'string' ? body.targetType : undefined;
    const targetId = typeof body.targetId === 'string' ? body.targetId : undefined;
    const metadata = asRecord(body.metadata);

    if (JSON.stringify(metadata).length > MAX_METADATA_CHARS) {
      throw new AppError(HTTP.BAD_REQUEST, 'metadata is too large');
    }

    // emitAudit reuses buildAuditContext → getClientIp for ip/requestId and
    // pulls actorId/actorRole from req.user (the bot owner admin). We only set
    // the event fields and default targetType to 'post'.
    emitAudit(req, {
      action,
      targetType: targetType ?? 'post',
      targetId,
      metadata,
    });

    return ok(res, { recorded: true });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
