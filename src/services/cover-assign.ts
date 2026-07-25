import { dbQuery } from '@/src/lib/db';
import {
  STOCK_COVERS,
  topicalCovers,
  BUNDLED_COVERS,
  pickDeterministic,
} from '@/src/utils/cover-pool';

import { fetchUnsplashCover } from './unsplash-cover';

// WHY THIS EXISTS. Covers used to be chosen by `pool[postId % poolSize]` in the
// news bot: pure rotation, no memory of what was already taken, and the pool was
// narrowed to the post's topic first. Nearly every post carries an AI tag, so
// 62 posts shared a 19-image pool while 80 other images sat unused — on the live
// blog one photo ended up on 5 posts, and 44 posts were duplicates.
//
// The fix is to make "used" a fact instead of an assumption: posts.cover_url IS
// the ledger. It covers bot posts and hand-written ones, survives a bot DB reset
// and can't drift, which a second copy of the list in the bot always would.
//
// The ladder below never repeats a cover while any free one exists, and widens
// past the topic rather than repeating — an off-topic but unique photo beats the
// same photo for the fifth time.

/** Warn the owner (systemd journal) while there is still time to top the pool up. */
const LOW_WATER_MARK = 20;

export type AssignedCover = {
  url: string;
  creditName?: string;
  creditUrl?: string;
};

/** How many posts sit on each cover — the used set and the tie-breaker in one query. */
async function coverCounts(): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ cover_url: string; count: string }>(
    "SELECT cover_url, COUNT(*) AS count FROM posts WHERE cover_url <> '' GROUP BY cover_url"
  );
  return new Map(rows.map((row) => [row.cover_url, Number(row.count)]));
}

/** The pool entry the fewest posts use — the graceful floor when nothing is free. */
function leastUsed(counts: Map<string, number>, seed: string): string {
  const inventory = [...STOCK_COVERS, ...BUNDLED_COVERS];
  const fewest = Math.min(...inventory.map((cover) => counts.get(cover) ?? 0));
  const tied = inventory.filter((cover) => (counts.get(cover) ?? 0) === fewest);
  // inventory is a non-empty literal list, so `tied` always has an entry; the
  // ?? keeps TypeScript honest without ever triggering.
  return pickDeterministic(tied, seed) ?? inventory[0];
}

/**
 * Picks a cover no other post uses, preferring the post's topic:
 *
 *   1. Unsplash (when UNSPLASH_ACCESS_KEY is set) — open-ended and on-topic
 *   2. free covers from the topical pool
 *   3. free covers from the WHOLE stock pool — off-topic but unique
 *   4. free bundled /assets covers
 *   5. the least-used cover — only when literally everything is taken
 *
 * Always resolves to a usable URL; steps 2–5 need no network. The caller decides
 * when to ask (only when the post has no cover of its own).
 */
export async function pickUnusedCover(input: {
  tags?: string[];
  title?: string;
}): Promise<AssignedCover> {
  const tags = input.tags ?? [];
  const seed = input.title ?? '';
  const counts = await coverCounts();
  const used = new Set(counts.keys());
  const isFree = (cover: string) => !used.has(cover);

  const fresh = await fetchUnsplashCover(tags, used);
  if (fresh) {
    return fresh;
  }

  // Only the static ladder can run dry, so the warning belongs here — with a
  // key configured we never get this far and there is nothing to top up.
  const freeStock = STOCK_COVERS.filter(isFree);
  const freeBundled = BUNDLED_COVERS.filter(isFree);
  const free = freeStock.length + freeBundled.length;
  if (free <= LOW_WATER_MARK) {
    // eslint-disable-next-line no-console
    console.warn(
      `[cover-pool] only ${free} unused covers left — add URLs to src/data/cover-pool.json or set UNSPLASH_ACCESS_KEY`
    );
  }

  const url =
    pickDeterministic(topicalCovers(tags).filter(isFree), seed) ??
    pickDeterministic(freeStock, seed) ??
    pickDeterministic(freeBundled, seed) ??
    leastUsed(counts, seed);

  return { url };
}
