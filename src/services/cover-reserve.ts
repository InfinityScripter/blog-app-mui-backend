import { dbQuery } from '@/src/lib/db';
import { topicFor } from '@/src/utils/cover-pool';

import { usedCovers } from './cover-ledger';
import {
  UNSPLASH_TOPICS,
  isUnsplashConfigured,
  pingUnsplashDownload,
  fetchUnsplashCandidates,
} from './unsplash-cover';

// WHY THIS EXISTS. Unsplash used to be fetched DURING publishing: "Создать пост"
// (and every news-bot publish) waited for api.unsplash.com before the response
// came back. That host is not reliably reachable — measured 2026-07-25, 3 of 5
// probes never answered — so every publish paid the full timeout, first 8s and
// then 3s after the budget was cut. Cutting the budget only shortened the
// freeze; the foreign service was still in our critical path.
//
// A cover is decoration with an instant free fallback, so it has no business
// there at all. The fetch now happens AHEAD of time into cover_reserve, and
// publishing just claims a ready row — one local DB round trip, no network.
//
// The claim is a DELETE ... RETURNING, which is the load-bearing detail: a row
// can only be deleted once, so two concurrent publishes physically cannot walk
// away with the same photo. That is stronger than the read-then-write the old
// path used, where both callers could read "free" before either one wrote.

/** How many photos to keep on hand. ~2 auto-covered posts a day → days of buffer. */
const TARGET_DEPTH = 20;

/** Requests per refill run. One returns 10 candidates; Unsplash allows 50/hour. */
const MAX_FETCHES_PER_RUN = 3;

export type ReservedCover = {
  url: string;
  creditName: string;
  creditUrl: string;
};

type ReserveRow = {
  url: string;
  topic: string;
  credit_name: string;
  credit_url: string;
  download_location: string | null;
};

/** How many photos are stashed right now. */
export async function reserveDepth(): Promise<number> {
  const { rows } = await dbQuery<{ count: string }>('SELECT COUNT(*) AS count FROM cover_reserve');
  return Number(rows[0]?.count ?? 0);
}

/**
 * Takes one photo out of the reserve for a post with these tags, preferring a
 * topic match but accepting any — an off-topic unique photo beats spending a
 * finite pool slot, the same trade the static ladder already makes.
 *
 * Returns null when the reserve is empty or holds nothing free, and the caller
 * falls back to the static pool. Never throws on the Unsplash side: the only
 * network here is the fire-and-forget attribution ping.
 */
export async function claimReservedCover(
  tags: readonly string[],
  used: ReadonlySet<string>
): Promise<ReservedCover | null> {
  const { rows } = await dbQuery<ReserveRow>(
    'SELECT url, topic, credit_name, credit_url, download_location FROM cover_reserve ORDER BY created_at'
  );

  // A photo can land in the reserve and then be used by a hand-made post before
  // it is claimed, so the ledger still has the last word here — exactly the same
  // check pickUnusedCover makes.
  const free = rows.filter((row) => !used.has(row.url));
  const wanted = topicFor(tags) ?? '';
  const ordered = [
    ...free.filter((row) => row.topic === wanted),
    ...free.filter((row) => row.topic !== wanted),
  ];

  for (let i = 0; i < ordered.length; i += 1) {
    // The claim. Whoever's DELETE affects the row owns the photo; a loser sees
    // rowCount 0 and moves to the next candidate instead of duplicating it.
    // eslint-disable-next-line no-await-in-loop
    const claimed = await dbQuery<ReserveRow>(
      'DELETE FROM cover_reserve WHERE url = $1 RETURNING url, topic, credit_name, credit_url, download_location',
      [ordered[i].url]
    );
    const row = claimed.rows[0];
    if (row) {
      pingUnsplashDownload(row.download_location);
      return { url: row.url, creditName: row.credit_name, creditUrl: row.credit_url };
    }
  }

  return null;
}

/** Reserve rows per topic, so a refill tops up the thinnest shelf first. */
async function depthByTopic(): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ topic: string; count: string }>(
    'SELECT topic, COUNT(*) AS count FROM cover_reserve GROUP BY topic'
  );
  return new Map(rows.map((row) => [row.topic, Number(row.count)]));
}

function thinnestTopic(counts: Map<string, number>): string {
  return UNSPLASH_TOPICS.reduce((thinnest, topic) =>
    (counts.get(topic) ?? 0) < (counts.get(thinnest) ?? 0) ? topic : thinnest
  );
}

/**
 * Tops the reserve up to TARGET_DEPTH. Runs in the background (see
 * cover-reserve-scheduler.ts) and is a no-op without a key or when the reserve
 * is already deep enough, so an idle tick costs one COUNT.
 *
 * Photos already on a post are skipped, and the url primary key means a photo
 * Unsplash hands back twice is stored once — so the reserve never becomes a
 * source of duplicate covers. Safe to run concurrently with itself.
 */
export async function refillCoverReserve(): Promise<{ added: number; depth: number }> {
  if (!isUnsplashConfigured()) {
    return { added: 0, depth: 0 };
  }

  let depth = await reserveDepth();
  if (depth >= TARGET_DEPTH) {
    return { added: 0, depth };
  }

  const [used, counts] = await Promise.all([usedCovers(), depthByTopic()]);
  let added = 0;

  for (let run = 0; run < MAX_FETCHES_PER_RUN && depth < TARGET_DEPTH; run += 1) {
    const topic = thinnestTopic(counts);
    // eslint-disable-next-line no-await-in-loop
    const candidates = await fetchUnsplashCandidates(topic);
    if (candidates.length === 0) {
      // The API is unhappy or unreachable — stop hammering it this run. The
      // reserve simply stays as deep as it was; nothing downstream breaks.
      break;
    }

    for (let i = 0; i < candidates.length && depth < TARGET_DEPTH; i += 1) {
      const candidate = candidates[i];
      if (!used.has(candidate.url)) {
        // eslint-disable-next-line no-await-in-loop
        const inserted = await dbQuery(
          `INSERT INTO cover_reserve (url, topic, credit_name, credit_url, download_location)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (url) DO NOTHING`,
          [
            candidate.url,
            topic,
            candidate.creditName,
            candidate.creditUrl,
            candidate.downloadLocation,
          ]
        );
        if (inserted.rowCount) {
          added += 1;
          depth += 1;
          counts.set(topic, (counts.get(topic) ?? 0) + 1);
        }
      }
    }
  }

  return { added, depth };
}
