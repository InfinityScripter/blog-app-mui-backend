import type { WarmOutcome, TranslatableFields } from '@/src/services/post-translation';

import { postService } from '@/src/services/post';
import { warmPostFull, warmPostSummary } from '@/src/services/post-translation';
import { TRANSLATABLE_LANGS, type TranslatableLang } from '@/src/constants/i18n';

// Translation warmup: pre-translate posts into every non-original locale and
// cache them, so a later feed/details read is a DB hit instead of a synchronous
// DeepL call. On the free tier a cold translation is slow enough to blow a
// Vercel request timeout (a feed 504s translating dozens of posts; even a
// single cold BODY can exceed 10s), so the read paths must hit a warm cache.
//
// Two modes:
//  - 'summary' → title + description only (scope='summary'). Enough for feeds.
//  - 'full'    → title + description + body (scope='full'). What a details page
//                needs. Slower (a body is many chunks), so it's the deeper warm.
//
// Because a full warm of a large corpus takes many minutes (free-tier pacing),
// warming runs DETACHED from the HTTP request (runWarmupInBackground) — the VDS
// `next start` process has no function timeout, so it can grind for minutes
// while the request returns 202 immediately.

export type WarmMode = 'summary' | 'full';

/** Per-language counts for a warmup run. */
export interface WarmLangStats {
  lang: TranslatableLang;
  translated: number;
  cached: number;
  error: number;
}

export interface WarmupResult {
  mode: WarmMode;
  posts: number;
  langs: WarmLangStats[];
  /** Total DeepL-translated posts across all languages this run. */
  translated: number;
  /** Total already-fresh posts reused across all languages. */
  cached: number;
  /** Total posts that could not be translated (provider error). */
  errors: number;
}

function emptyStats(lang: TranslatableLang): WarmLangStats {
  return { lang, translated: 0, cached: 0, error: 0 };
}

function tally(stats: WarmLangStats, outcome: WarmOutcome): WarmLangStats {
  if (outcome === 'translated') return { ...stats, translated: stats.translated + 1 };
  if (outcome === 'cached') return { ...stats, cached: stats.cached + 1 };
  if (outcome === 'error') return { ...stats, error: stats.error + 1 };
  // 'skipped' only happens for `ru`, which warmup never passes — count nothing.
  return stats;
}

function warmOne<T extends TranslatableFields>(
  post: T,
  lang: TranslatableLang,
  mode: WarmMode
): Promise<WarmOutcome> {
  return mode === 'full' ? warmPostFull(post, lang) : warmPostSummary(post, lang);
}

/**
 * Warms every published post into every translatable locale (or just `onlyLang`)
 * at the given `mode`. Runs SEQUENTIALLY across (lang × post) — mirroring the
 * read path — so the DeepL fan-out stays within the free-tier rate limit (429).
 * Never throws: warmPost* swallows per-post provider errors into an 'error'
 * tally, and a failed language leaves the rest of the run intact. Returns the
 * aggregate counts (also logged as it goes, for the background path).
 */
export async function warmFeedTranslations(
  onlyLang?: TranslatableLang,
  mode: WarmMode = 'summary'
): Promise<WarmupResult> {
  // Unpaginated, anonymous scope → every PUBLISHED post, with full fields
  // (mapListPost spreads the lean doc, so title/description/content are present
  // and the source_hash matches what the read paths compute).
  const { posts } = await postService.listPosts({});

  const targetLangs = onlyLang ? [onlyLang] : TRANSLATABLE_LANGS;

  const langs = await targetLangs.reduce<Promise<WarmLangStats[]>>(
    async (accPromise, lang) => {
      const acc = await accPromise;
      const stats = await posts.reduce<Promise<WarmLangStats>>(
        async (statPromise, post) => {
          const running = await statPromise;
          const outcome = await warmOne(post, lang, mode);
          return tally(running, outcome);
        },
        Promise.resolve(emptyStats(lang))
      );
      // eslint-disable-next-line no-console
      console.info(
        `[warmup] ${mode} ${lang}: translated=${stats.translated} cached=${stats.cached} error=${stats.error} of ${posts.length}`
      );
      return [...acc, stats];
    },
    Promise.resolve([])
  );

  return {
    mode,
    posts: posts.length,
    langs,
    translated: langs.reduce((sum, s) => sum + s.translated, 0),
    cached: langs.reduce((sum, s) => sum + s.cached, 0),
    errors: langs.reduce((sum, s) => sum + s.error, 0),
  };
}

// Single-flight guard for the DETACHED warm: a warm issues many sequential
// DeepL calls tuned to the free-tier rate limit; two overlapping runs would
// double the fan-out and trip 429s. Module-scoped (per backend process).
let backgroundRunning = false;

/** Whether a detached warmup is currently running in this process. */
export function isWarmupRunning(): boolean {
  return backgroundRunning;
}

/**
 * Kicks off a warmup DETACHED from the caller: returns immediately with whether
 * it started (false if one is already running). The run itself is not awaited —
 * it grinds in the background of the long-lived VDS process (no request timeout)
 * and logs its result. Intended for the admin warm endpoint, which acks 202.
 */
export function runWarmupInBackground(onlyLang?: TranslatableLang, mode: WarmMode = 'summary'): boolean {
  if (backgroundRunning) {
    return false;
  }
  backgroundRunning = true;
  // Detached: no await. Errors are logged; backgroundRunning always clears.
  warmFeedTranslations(onlyLang, mode)
    .then((result) => {
      // eslint-disable-next-line no-console
      console.info('[warmup] background run finished', JSON.stringify(result));
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[warmup] background run failed', error);
    })
    .finally(() => {
      backgroundRunning = false;
    });
  return true;
}

/**
 * Warms ONE post into every translatable locale (sequentially). Called
 * fire-and-forget right after a post is created/published so its feed title (and
 * optionally body) is translated before a visitor arrives — without blocking the
 * create response. Never throws; the caller ignores the returned promise. Only
 * makes sense for a published post — the caller guards on that. `mode` defaults
 * to 'full' so a freshly published post is fully ready (feed + details) in one
 * pass (one post's body is a bounded cost, unlike a whole corpus).
 */
export async function warmPostTranslations(
  post: TranslatableFields & { id?: string; _id?: string },
  mode: WarmMode = 'full'
): Promise<void> {
  await TRANSLATABLE_LANGS.reduce<Promise<void>>(async (accPromise, lang) => {
    await accPromise;
    await warmOne(post, lang, mode);
  }, Promise.resolve());
}
