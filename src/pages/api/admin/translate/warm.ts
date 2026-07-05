import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { ok, fail, sendError } from '@/src/utils/response';
import { requireAuth } from '@/src/middlewares/require-auth';
import { requireAdmin } from '@/src/middlewares/require-admin';
import { warmFeedTranslations } from '@/src/services/translation-warmup';
import { LANG, TRANSLATABLE_LANGS, type TranslatableLang } from '@/src/constants/i18n';

// Admin-only: warm the feed-title translation cache (title + description of
// every published post) into every non-original locale. After a run, feeds can
// render translated titles as a DB hit instead of per-request DeepL calls.
// POST /api/admin/translate/warm            → warm all translatable locales
// POST /api/admin/translate/warm?lang=en    → warm only that locale
//
// This runs on the VDS backend (`next start`, no serverless timeout), so a
// synchronous ~N-post × short-field DeepL pass is fine here — the timeout that
// forced feeds to stay original applies to the Vercel FRONTEND, not this route.

// In-memory single-flight guard: a warmup issues many sequential DeepL calls
// tuned to the free-tier rate limit; two concurrent runs would double the
// fan-out and trip 429s. A second call while one is running is rejected (409)
// rather than piling on. Per-process — good enough for a single backend node.
let running = false;

/** Narrows an optional ?lang= to a translatable locale (not `ru`); undefined = all. */
function parseOnlyLang(raw: string | string[] | undefined): TranslatableLang | undefined {
  if (typeof raw !== 'string') return undefined;
  return TRANSLATABLE_LANGS.find((lang) => lang === raw);
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

  if (running) {
    return fail(res, HTTP.CONFLICT, 'A translation warmup is already running.');
  }

  running = true;
  try {
    const result = await warmFeedTranslations(parseOnlyLang(req.query.lang));
    return ok(res, result, { message: 'Feed translation cache warmed.' });
  } catch (error) {
    return sendError(res, error);
  } finally {
    running = false;
  }
}

export default requireAuth(requireAdmin(handler));
