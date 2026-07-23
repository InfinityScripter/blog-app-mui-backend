import type { NextApiRequest, NextApiResponse } from 'next';

import { AppError } from '@/src/types/api';
import { MSG } from '@/src/constants/messages';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { settingsService } from '@/src/services/settings';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';

// The two auto-publish master switches this route can toggle. Kept as a local
// allow-list (not the full FlagKey union) so this route can never flip an
// unrelated flag like pdCollection — only the bot's auto-publish switches.
const AUTO_PUBLISH_KEYS = ['autoPublishReleases', 'autoPublishNews'] as const;
type AutoPublishKey = (typeof AUTO_PUBLISH_KEYS)[number];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isAutoPublishKey(value: unknown): value is AutoPublishKey {
  return AUTO_PUBLISH_KEYS.includes(value as AutoPublishKey);
}

// Thin admin route: toggle one of the news-bot auto-publish flags. One keyed
// route (body { key, enabled }) rather than two near-identical handlers, since
// the only difference is which flag is set. requireAuth(requireAdmin) →
// settingsService.setFlag → audit → respond with the new state.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    const body = asRecord(req.body);
    if (!isAutoPublishKey(body.key)) {
      throw new AppError(HTTP.BAD_REQUEST, 'key must be autoPublishReleases or autoPublishNews');
    }
    if (typeof body.enabled !== 'boolean') {
      throw new AppError(HTTP.BAD_REQUEST, 'enabled must be a boolean');
    }
    await settingsService.setFlag(body.key, body.enabled);
    emitAudit(req, {
      action: 'settings.auto_publish_toggled',
      targetType: 'setting',
      targetId: body.key,
      metadata: { enabled: body.enabled },
    });
    return ok(
      res,
      { [body.key]: body.enabled },
      {
        message: body.enabled ? 'Автопубликация включена' : 'Автопубликация выключена',
      }
    );
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(requireAdmin(handler));
