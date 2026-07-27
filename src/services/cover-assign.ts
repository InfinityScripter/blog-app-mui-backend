import {
  STOCK_COVERS,
  topicalCovers,
  BUNDLED_COVERS,
  pickDeterministic,
} from '@/src/utils/cover-pool';

import { coverCounts } from './cover-ledger';
import { claimReservedCover } from './cover-reserve';

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
 *   1. the Unsplash reserve (when UNSPLASH_ACCESS_KEY is set) — open-ended
 *   2. free covers from the topical pool
 *   3. free covers from the WHOLE stock pool — off-topic but unique
 *   4. free bundled /assets covers
 *   5. the least-used cover — only when literally everything is taken
 *
 * Always resolves to a usable URL, and NEVER touches the network: step 1 reads
 * photos a background job fetched ahead of time (services/cover-reserve.ts), so
 * an Unsplash outage costs a pool cover, not a stalled publish. The caller
 * decides when to ask (only when the post has no cover of its own).
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

  const reserved = await claimReservedCover(tags, used);
  if (reserved) {
    return reserved;
  }

  // Only the static ladder can run dry, so the warning belongs here. With a key
  // configured this is the path taken while the reserve happens to be empty —
  // a fresh boot, a burst of publishes, or an Unsplash outage — so it is worth
  // knowing how much runway the offline pool still has.
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
