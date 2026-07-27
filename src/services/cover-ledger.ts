import { dbQuery } from '@/src/lib/db';

// posts.cover_url IS the registry of taken covers — see services/cover-assign.ts
// for why the ledger lives in the DB rather than in the publisher. That query
// has two readers now (the picker and the reserve refill), so it lives here:
// two copies of "what counts as used" is exactly the drift this design exists
// to prevent.

/** How many posts sit on each cover — the used set and the tie-breaker in one query. */
export async function coverCounts(): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ cover_url: string; count: string }>(
    "SELECT cover_url, COUNT(*) AS count FROM posts WHERE cover_url <> '' GROUP BY cover_url"
  );
  return new Map(rows.map((row) => [row.cover_url, Number(row.count)]));
}

/** Every cover URL already on a post. */
export async function usedCovers(): Promise<Set<string>> {
  return new Set((await coverCounts()).keys());
}
