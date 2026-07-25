import coverPool from '@/src/data/cover-pool.json';

import { coverSeed } from './post-payload';

// The stock pool, the tag→topic map and the bundled asset list live in
// src/data/cover-pool.json so the runtime, the prod backfill script
// (scripts/dedup-stock-covers.mjs) and the tests all read ONE list. Before this
// the same URLs were copy-pasted into the news bot and into a snapshot under
// scripts/, and the copies drifted apart.
const POOLS = coverPool.pools as Record<string, string[]>;
const TAG_TO_TOPIC = coverPool.tagMap as Record<string, string>;

/**
 * Every stock cover URL, de-duplicated — the topical pools deliberately overlap
 * (a data-centre photo fits both `tech` and `ai`), so a flat union is the real
 * inventory. This is also the list the "is this an auto-assigned cover?" check
 * uses, in the runtime and in the backfill script alike.
 *
 * `Array.from`, not `[...set]`: tsconfig targets es5 without downlevelIteration,
 * where spreading a Set silently compiles to an EMPTY array instead of erroring.
 */
export const STOCK_COVERS: string[] = Array.from(new Set(Object.values(POOLS).flat()));

/** Covers shipped inside public/assets — the offline tail of the inventory. */
export const BUNDLED_COVERS: string[] = coverPool.bundled;

/**
 * Resolves a post's topic from its tags — the first tag with a mapping wins.
 * `новости` / `политика` and other tags without a visual theme are absent from
 * the map on purpose and yield null, which means "no topical preference".
 */
export function topicFor(tags: readonly string[] = []): string | null {
  const topic = tags
    .map((tag) => TAG_TO_TOPIC[String(tag).toLowerCase().trim()])
    .find((value) => Boolean(value));
  return topic ?? null;
}

/** The topical slice of the pool for these tags; empty when no tag maps. */
export function topicalCovers(tags: readonly string[] = []): string[] {
  const topic = topicFor(tags);
  return topic ? (POOLS[topic] ?? []) : [];
}

/**
 * Picks one candidate deterministically from the post title. Same title + same
 * candidate list → same cover, so a retried publish of one post never burns a
 * second image. Reuses the hash the bundled-cover default already uses.
 */
export function pickDeterministic(candidates: readonly string[], seed: string): string | null {
  if (candidates.length === 0) {
    return null;
  }
  return candidates[coverSeed(seed) % candidates.length] ?? null;
}
