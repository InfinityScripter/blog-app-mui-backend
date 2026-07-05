import type { NextApiRequest, NextApiResponse } from 'next';
import type { WarmMode } from '@/src/services/translation-warmup';

import { MSG } from '@/src/constants/messages';
import { ok, fail } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { LANG, TRANSLATABLE_LANGS, type TranslatableLang } from '@/src/constants/i18n';
import { isWarmupRunning, runWarmupInBackground } from '@/src/services/translation-warmup';

// Admin-only: warm the post-translation cache so feeds/details read a warm DB
// hit instead of translating on the request path (which, on the free tier, 504s
// — a whole feed, or even a single cold body). The run is DETACHED: this route
// returns 202 immediately and the warm grinds in the background of the VDS
// process (no serverless timeout), because a full-corpus warm takes minutes.
//
// POST /api/admin/translate/warm                    → summary warm, all locales
// POST /api/admin/translate/warm?mode=full          → full (body) warm too
// POST /api/admin/translate/warm?lang=en&mode=full  → only that locale
//
// Query:
//   lang  = a translatable locale (not `ru`); omit = all. ru/unknown → 400.
//   mode  = 'summary' (default, feed titles) | 'full' (also post bodies).

/** Narrows an optional ?lang= to a translatable locale (not `ru`); undefined = all. */
function parseOnlyLang(raw: string | string[] | undefined): TranslatableLang | undefined {
  if (typeof raw !== 'string') return undefined;
  return TRANSLATABLE_LANGS.find((lang) => lang === raw);
}

/** Narrows ?mode= to a WarmMode; anything else defaults to 'summary'. */
function parseMode(raw: string | string[] | undefined): WarmMode {
  return raw === 'full' ? 'full' : 'summary';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  // A ?lang= that is present but not a translatable locale (e.g. ru, or junk) is
  // a client mistake — 400 rather than silently warming everything.
  if (typeof req.query.lang === 'string' && parseOnlyLang(req.query.lang) === undefined) {
    return fail(
      res,
      HTTP.BAD_REQUEST,
      `Unsupported lang '${req.query.lang}'. '${LANG.RU}' is the original (never translated).`
    );
  }

  const mode = parseMode(req.query.mode);
  const started = runWarmupInBackground(parseOnlyLang(req.query.lang), mode);

  if (!started) {
    // Already running — not an error; report it so a caller can poll/retry.
    return ok(res, { started: false, running: true, mode }, {
      status: HTTP.OK,
      message: 'A translation warmup is already running.',
    });
  }

  // 202 Accepted: the warm runs detached; watch the server logs ([warmup] …) for
  // progress and the final counts.
  return ok(res, { started: true, running: isWarmupRunning(), mode }, {
    status: HTTP.ACCEPTED,
    message: `Translation warmup started (mode=${mode}). Runs in the background.`,
  });
}

export default requireAuth(requireAdmin(handler));
