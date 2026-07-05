import type { Lang } from '@/src/constants/i18n';

import { dbQuery } from '@/src/lib/db';
import { createHash } from 'node:crypto';
import { translationProvider } from '@/src/utils/translate';
import { LANG, DEEPL_SOURCE_LANG, DEEPL_TARGET_BY_LANG } from '@/src/constants/i18n';

// Post-content translation with a DB cache (post_translations). See the FE↔BE
// contract: `ru` is the original (passthrough); other locales are DeepL-
// translated, cached per (post_id, lang), and re-fetched when the source
// changes. The read path NEVER fails because of translation — on any provider
// error we degrade to the original fields.
//
// A cached row has a SCOPE (see db.ts):
//  - 'full'    → title + description + content translated. What the details
//                route writes and the only scope it will serve.
//  - 'summary' → title + description translated, content = the original. What
//                the feed warmup and the list route write (lists never render a
//                body). Cheap: two short DeepL calls per post instead of a whole
//                body. Opening the post upgrades the row to 'full'.

/** The subset of a post that carries translatable text. */
export interface TranslatableFields {
  title: string;
  description: string;
  content: string;
}

/** How complete a cached translation is. */
export type TranslationScope = 'summary' | 'full';

interface TranslationRow {
  title: string;
  description: string;
  content: string;
  source_hash: string;
  scope: string;
  status: string;
}

/**
 * Whether a cached row is a usable HIT for reuse: fresh (source unchanged) AND a
 * real translation (status='ok'). An `error` row records a past provider failure
 * and holds the ORIGINAL fields — it must NOT be served or counted as cached, or
 * a transient outage would pin a post to its untranslated text forever (the
 * source_hash stays fresh, so it would never retry). Callers additionally check
 * `scope` when they need a full body.
 */
function isFreshOk(row: TranslationRow | null, hash: string): row is TranslationRow {
  return row !== null && row.source_hash === hash && row.status === 'ok';
}

/**
 * Stable hash of the original translatable fields. A change to any field
 * changes the hash, invalidating a cached translation (guards against serving
 * stale text after a post edit).
 */
function sourceHash(fields: TranslatableFields): string {
  return createHash('sha256')
    .update([fields.title, fields.description, fields.content].join(' '))
    .digest('hex');
}

async function readCache(postId: string, lang: Lang): Promise<TranslationRow | null> {
  const result = await dbQuery<TranslationRow>(
    'SELECT title, description, content, source_hash, scope, status FROM post_translations WHERE post_id = $1 AND lang = $2 LIMIT 1',
    [postId, lang]
  );
  return result.rows[0] ?? null;
}

async function upsertCache(
  postId: string,
  lang: Lang,
  fields: TranslatableFields,
  hash: string,
  status: 'ok' | 'error',
  scope: TranslationScope
): Promise<void> {
  await dbQuery(
    `
      INSERT INTO post_translations (post_id, lang, title, description, content, source_hash, status, scope, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (post_id, lang) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        content = EXCLUDED.content,
        source_hash = EXCLUDED.source_hash,
        status = EXCLUDED.status,
        scope = EXCLUDED.scope,
        updated_at = NOW()
    `,
    [postId, lang, fields.title, fields.description, fields.content, hash, status, scope]
  );
}

async function translateFields(
  fields: TranslatableFields,
  target: string
): Promise<TranslatableFields> {
  const opts = { source: DEEPL_SOURCE_LANG, target };
  // Translate the three fields SEQUENTIALLY (not Promise.all): three concurrent
  // requests per post, multiplied across a list, overwhelm DeepL's free-tier
  // rate limit (429). Serial keeps the concurrency low; the result is cached.
  const title = await translationProvider.translateHtml(fields.title, opts);
  const description = await translationProvider.translateHtml(fields.description, opts);
  const content = await translationProvider.translateHtml(fields.content, opts);
  return { title, description, content };
}

/**
 * Returns the post's translatable fields in `lang`, translating the FULL post
 * (title + description + content) and caching a `scope='full'` row. Used by the
 * details route.
 *  - `ru` (or the original) → the fields unchanged (no DB touch).
 *  - other locale → cache-or-translate: a fresh FULL cache hit is returned
 *    as-is; a miss, a stale entry, or a `scope='summary'` row (body not yet
 *    translated) is (re)translated in full, upserted as 'full', and returned.
 *  - provider/config error → the ORIGINAL fields, with a best-effort
 *    `status='error'` cache row and a logged error. Never throws to the caller.
 */
export async function getTranslatedPostFields<T extends TranslatableFields>(
  post: T,
  lang: Lang
): Promise<TranslatableFields> {
  const original: TranslatableFields = {
    title: post.title,
    description: post.description,
    content: post.content,
  };

  if (lang === LANG.RU) {
    return original;
  }

  const target = DEEPL_TARGET_BY_LANG[lang];
  const hash = sourceHash(original);
  const postId = getPostId(post);

  const cached = await readCache(postId, lang);
  // Only a fresh, OK, FULL row satisfies the details read — a summary row has an
  // untranslated body (upgrade), and an error row holds the original (retry).
  if (isFreshOk(cached, hash) && cached.scope === 'full') {
    return {
      title: cached.title,
      description: cached.description,
      content: cached.content,
    };
  }

  try {
    const translated = await translateFields(original, target);
    await upsertCache(postId, lang, translated, hash, 'ok', 'full');
    return translated;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[post-translation] degrade to original for', postId, lang, error);
    // Best-effort: record the failure so we can see it, but never let a cache
    // write failure break the read either. An error row keeps scope 'full' so a
    // later successful details read overwrites it.
    try {
      await upsertCache(postId, lang, original, hash, 'error', 'full');
    } catch (cacheError) {
      // eslint-disable-next-line no-console
      console.error('[post-translation] failed to record error row for', postId, cacheError);
    }
    return original;
  }
}

/** Reads the original post id (`id` on mapped posts; falls back to `_id`). */
function getPostId(post: TranslatableFields & { id?: string; _id?: string }): string {
  return post.id ?? post._id ?? '';
}

/**
 * Translates a post's SHORT fields (title + description) for list/feed views,
 * which never render the body, and caches a `scope='summary'` row so the next
 * list render (and the warmup) is a free DB hit.
 *  - A fresh cache hit of EITHER scope is reused with no network call (a full
 *    row's short fields are already correct; a summary row is exactly this).
 *  - A miss/stale entry translates only title + description, writes a summary
 *    row (body kept as the original — details will translate + upgrade it), and
 *    returns. Writing summary is safe because getTranslatedPostFields refuses to
 *    serve a summary row for the body.
 *  - Provider error → the original short fields, no cache write. Never throws.
 */
async function translateSummaryFields<T extends TranslatableFields>(
  post: T,
  lang: Lang
): Promise<TranslatableFields> {
  const original: TranslatableFields = {
    title: post.title,
    description: post.description,
    content: post.content,
  };

  if (lang === LANG.RU) {
    return original;
  }

  const postId = getPostId(post);
  const hash = sourceHash(original);
  const cached = await readCache(postId, lang);
  if (isFreshOk(cached, hash)) {
    // Fresh OK row of either scope — reuse its short fields (and body: for a full
    // row it's the real translation, for a summary row it's the original, which
    // is fine since the caller renders only title/description). An error row is
    // NOT reused (isFreshOk excludes it) — it re-translates below.
    return {
      title: cached.title,
      description: cached.description,
      content: cached.content,
    };
  }

  const opts = { source: DEEPL_SOURCE_LANG, target: DEEPL_TARGET_BY_LANG[lang] };
  try {
    const title = await translationProvider.translateHtml(original.title, opts);
    const description = await translationProvider.translateHtml(original.description, opts);
    const summary: TranslatableFields = { title, description, content: original.content };
    // Self-warm: cache the summary so the next list render is a DB hit. Body is
    // the original — scope='summary' bars getTranslatedPostFields from serving
    // it, so the details route still translates + upgrades to 'full'.
    await upsertCache(postId, lang, summary, hash, 'ok', 'summary');
    return summary;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[post-translation] summary degrade to original for', postId, lang, error);
    return original;
  }
}

/**
 * Translates a list of posts for list/feed views. `ru` returns the input
 * untouched. Only the SHORT fields (title + description) are translated — list
 * views don't render bodies — so a cold-cache list issues at most two short
 * DeepL calls per post instead of translating every full body. Runs
 * SEQUENTIALLY (not Promise.all) so the fan-out stays within DeepL's free-tier
 * rate limit (429). Fresh translations already in the cache (of either scope)
 * are reused without any network call, so a warmed feed stays fast. Each cold
 * post also self-warms a summary row (translateSummaryFields). Body translation
 * + upgrade to a full row is deferred to the details route.
 */
export async function translatePosts<T extends TranslatableFields>(
  posts: T[],
  lang: Lang
): Promise<T[]> {
  if (lang === LANG.RU) {
    return posts;
  }
  return posts.reduce<Promise<T[]>>(async (accPromise, post) => {
    const acc = await accPromise;
    const fields = await translateSummaryFields(post, lang);
    return [...acc, { ...post, ...fields }];
  }, Promise.resolve([]));
}

/** Outcome of warming one post's summary translation in one language. */
export type WarmOutcome = 'translated' | 'cached' | 'skipped' | 'error';

/**
 * Warms the SUMMARY (title + description) translation of one post in one
 * language into the cache, so a later feed render is a DB hit rather than a
 * per-request DeepL call (which, across a whole feed, blows the serverless
 * timeout). Reuses an existing fresh row of either scope. Never throws — the
 * warmup loop must survive one bad post.
 *  - `ru`                          → 'skipped' (never translated/stored).
 *  - fresh row already cached      → 'cached' (no network).
 *  - translated + summary upserted → 'translated'.
 *  - provider/config error         → 'error' (original left; no cache write).
 */
export async function warmPostSummary<T extends TranslatableFields>(
  post: T,
  lang: Lang
): Promise<WarmOutcome> {
  if (lang === LANG.RU) {
    return 'skipped';
  }

  const original: TranslatableFields = {
    title: post.title,
    description: post.description,
    content: post.content,
  };
  const postId = getPostId(post);
  const hash = sourceHash(original);

  const cached = await readCache(postId, lang);
  // Any fresh OK row (summary or full) means the short fields are already done;
  // an error row is re-translated (isFreshOk excludes it).
  if (isFreshOk(cached, hash)) {
    return 'cached';
  }

  const opts = { source: DEEPL_SOURCE_LANG, target: DEEPL_TARGET_BY_LANG[lang] };
  try {
    const title = await translationProvider.translateHtml(original.title, opts);
    const description = await translationProvider.translateHtml(original.description, opts);
    await upsertCache(
      postId,
      lang,
      { title, description, content: original.content },
      hash,
      'ok',
      'summary'
    );
    return 'translated';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[post-translation] warm failed for', postId, lang, error);
    return 'error';
  }
}

/**
 * Warms the FULL translation (title + description + BODY) of one post in one
 * language into the cache (scope='full'), so a later details read is a DB hit
 * rather than a cold body translation — which, on the free tier, can exceed even
 * a single serverless request's timeout (the details page 504s on a cold body).
 * Reuses an existing fresh FULL row (a summary row is upgraded). Never throws.
 *  - `ru`                        → 'skipped'.
 *  - fresh FULL row cached       → 'cached' (no network).
 *  - translated + full upserted  → 'translated'.
 *  - provider/config error       → 'error' (original left; no cache write).
 */
export async function warmPostFull<T extends TranslatableFields>(
  post: T,
  lang: Lang
): Promise<WarmOutcome> {
  if (lang === LANG.RU) {
    return 'skipped';
  }

  const original: TranslatableFields = {
    title: post.title,
    description: post.description,
    content: post.content,
  };
  const postId = getPostId(post);
  const hash = sourceHash(original);

  const cached = await readCache(postId, lang);
  // Only a fresh, OK, FULL row means the body is already done; a summary row is
  // upgraded, and an error row is retried (isFreshOk excludes it).
  if (isFreshOk(cached, hash) && cached.scope === 'full') {
    return 'cached';
  }

  try {
    const translated = await translateFields(original, DEEPL_TARGET_BY_LANG[lang]);
    await upsertCache(postId, lang, translated, hash, 'ok', 'full');
    return 'translated';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[post-translation] full warm failed for', postId, lang, error);
    return 'error';
  }
}
