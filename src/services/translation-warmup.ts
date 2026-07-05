import type { WarmOutcome, TranslatableFields } from '@/src/services/post-translation';

import { postService } from '@/src/services/post';
import { warmPostSummary } from '@/src/services/post-translation';
import { TRANSLATABLE_LANGS, type TranslatableLang } from '@/src/constants/i18n';

// Feed warmup: pre-translate the SUMMARY (title + description) of every
// published post into every non-original locale and cache it (scope='summary').
// Rendering a whole feed then becomes a DB hit instead of dozens of per-request
// DeepL calls — which, synchronously, blow the serverless timeout (why feeds
// otherwise show the original titles). Opening a post still translates + caches
// its body (details route, scope='full'). Safe to run repeatedly: a post whose
// summary is already fresh in the cache is skipped ('cached').

/** Per-language counts for a warmup run. */
export interface WarmLangStats {
  lang: TranslatableLang;
  translated: number;
  cached: number;
  error: number;
}

export interface WarmupResult {
  posts: number;
  langs: WarmLangStats[];
  /** Total DeepL-translated summaries across all languages this run. */
  translated: number;
  /** Total already-fresh summaries reused across all languages. */
  cached: number;
  /** Total posts whose summary could not be translated (provider error). */
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

/**
 * Warms the summary translation of every published post into every translatable
 * locale. Runs SEQUENTIALLY across (post × lang) — mirroring the list path — so
 * the DeepL fan-out stays within the free-tier rate limit (429). Never throws:
 * warmPostSummary swallows per-post provider errors into an 'error' tally, and a
 * failed language leaves the rest of the run intact.
 *
 * Optionally scoped to `onlyLang` (warm just that locale) — used by an
 * incremental post-publish warm.
 */
export async function warmFeedTranslations(onlyLang?: TranslatableLang): Promise<WarmupResult> {
  // Unpaginated, anonymous scope → every PUBLISHED post, with full fields
  // (mapListPost spreads the lean doc, so title/description/content are present
  // and the source_hash matches what the details route computes).
  const { posts } = await postService.listPosts({});

  const targetLangs = onlyLang ? [onlyLang] : TRANSLATABLE_LANGS;

  // reduce (not for-of: es5 target) over languages, then over posts, awaiting
  // each so calls never overlap.
  const langs = await targetLangs.reduce<Promise<WarmLangStats[]>>(
    async (accPromise, lang) => {
      const acc = await accPromise;
      const stats = await posts.reduce<Promise<WarmLangStats>>(
        async (statPromise, post) => {
          const running = await statPromise;
          const outcome = await warmPostSummary(post, lang);
          return tally(running, outcome);
        },
        Promise.resolve(emptyStats(lang))
      );
      return [...acc, stats];
    },
    Promise.resolve([])
  );

  return {
    posts: posts.length,
    langs,
    translated: langs.reduce((sum, s) => sum + s.translated, 0),
    cached: langs.reduce((sum, s) => sum + s.cached, 0),
    errors: langs.reduce((sum, s) => sum + s.error, 0),
  };
}

/**
 * Warms ONE post's summary into every translatable locale (sequentially).
 * Called fire-and-forget right after a post is created/published so its feed
 * title is translated before a visitor hits the feed — without blocking the
 * create response. Never throws (warmPostSummary swallows provider errors); the
 * caller ignores the returned promise. Only makes sense for a published post
 * (drafts never appear in a public feed) — the caller guards on that.
 */
export async function warmPostTranslations(
  post: TranslatableFields & { id?: string; _id?: string }
): Promise<void> {
  await TRANSLATABLE_LANGS.reduce<Promise<void>>(async (accPromise, lang) => {
    await accPromise;
    await warmPostSummary(post, lang);
  }, Promise.resolve());
}
