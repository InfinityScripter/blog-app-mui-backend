// Unsplash is the OPEN-ENDED cover source: the static pool is finite (≈120
// images at ~2 auto-covered posts a day it runs out in weeks), and once it is
// drained covers start repeating again — the exact problem this whole mechanism
// exists to kill. With a key configured every post gets a photo nobody used
// before. Without a key this module is a no-op and the static ladder takes over,
// so the blog keeps working with no configuration at all.
const RANDOM_URL = 'https://api.unsplash.com/photos/random';

// NOBODY WAITS FOR THIS. Until 2026-07-27 this call sat on the synchronous
// publish path, so the budget had to be what a stalled publish costs: 8s froze
// the dashboard for 8s on every unreachable attempt (api.unsplash.com is not
// reliably reachable — measured 2026-07-25, 3 of 5 probes never answered while
// the ones that did came back in ~0.5s), and cutting it to 3s only made the
// freeze shorter. Now these photos are fetched AHEAD of publishing, into the
// cover_reserve table, by a background job (services/cover-reserve.ts), so a
// slow reply delays nobody. The budget is back to a roomy one — losing the race
// costs a reserve slot we simply top up on the next tick, but timing out early
// on a link that WOULD have answered costs a real photo.
const TIMEOUT_MS = 10_000;

// The attribution ping is fire-and-forget, so a slow one delays nobody; keep the
// old, roomier budget there rather than dropping pings Unsplash's terms require.
const ATTRIBUTION_TIMEOUT_MS = 8_000;

// One request returns several candidates — the reserve stashes every usable one,
// so a single round trip fills many publishes.
const CANDIDATES = 10;

// Required by the Unsplash API guidelines on every link back to unsplash.com.
const UTM = 'utm_source=aifirst&utm_medium=referral';

/**
 * Search terms per topic. The blog's tags are Russian, Unsplash's index is
 * English, so a raw tag ("нейросети") returns junk — the topic id from
 * src/data/cover-pool.json is mapped to an English query instead.
 */
const TOPIC_QUERIES: Record<string, string> = {
  ai: 'artificial intelligence technology',
  security: 'cyber security',
  dev: 'software development code',
  gadgets: 'gadgets devices',
  science: 'science research laboratory',
  business: 'business analytics charts',
  tech: 'technology abstract',
};
const DEFAULT_QUERY = 'technology abstract';

/** The topics the reserve keeps stock for — the ones we can actually query. */
export const UNSPLASH_TOPICS: string[] = Object.keys(TOPIC_QUERIES);

export type UnsplashCandidate = {
  url: string;
  creditName: string;
  creditUrl: string;
  /** Unsplash's per-photo attribution endpoint; pinged when the photo is used. */
  downloadLocation: string | null;
};

type RandomPhoto = {
  urls?: { raw?: string };
  links?: { download_location?: string };
  user?: { name?: string; links?: { html?: string } };
};

/** Whether a key is configured at all; without one this module is a no-op. */
export function isUnsplashConfigured(): boolean {
  return Boolean(process.env.UNSPLASH_ACCESS_KEY);
}

/**
 * Normalizes a photo URL to exactly the shape the static pool uses:
 * `https://images.unsplash.com/photo-<id>?auto=format&fit=crop&w=1200&q=80`.
 *
 * Dropping the query string is load-bearing, not cosmetic: `urls.raw` carries an
 * `ixid` tracking token that changes on every API call, so keeping it would make
 * the SAME photo look like a brand-new URL and the "already used" check would
 * never fire — covers would silently repeat again.
 */
function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}?auto=format&fit=crop&w=1200&q=80`;
  } catch {
    return null;
  }
}

/**
 * Tells Unsplash the photo was used. Required by their API terms; deliberately
 * fire-and-forget — a failed ping must never cost us a cover or delay a publish.
 * Fires when a photo is CLAIMED off the reserve (that is when it becomes a real
 * cover), not when it is stashed — stashing is not a use.
 */
export function pingUnsplashDownload(location: string | null | undefined) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!location || !accessKey) {
    return;
  }
  fetch(location, {
    headers: { Authorization: `Client-ID ${accessKey}` },
    signal: AbortSignal.timeout(ATTRIBUTION_TIMEOUT_MS),
  }).catch(() => {
    // Ignored on purpose: attribution bookkeeping, not part of publishing.
  });
}

/**
 * Fetches a batch of candidate photos for one topic. Returns an empty array —
 * never throws — when the key is missing, the API is unhappy or the body is
 * malformed; the reserve then simply stays as deep as it was and the static
 * ladder covers the next publish. Fail-soft is the whole point: a cover is
 * decoration, and an Unsplash outage must not be able to break publishing.
 *
 * Caller-side duties this deliberately does NOT do: filtering out photos already
 * on a post, and pinging download_location. Both belong to the moment a photo
 * becomes a real cover, which is the claim in services/cover-reserve.ts.
 */
export async function fetchUnsplashCandidates(topic: string | null): Promise<UnsplashCandidate[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    return [];
  }

  const query = (topic && TOPIC_QUERIES[topic]) || DEFAULT_QUERY;
  const endpoint =
    `${RANDOM_URL}?query=${encodeURIComponent(query)}` +
    `&orientation=landscape&content_filter=high&count=${CANDIDATES}`;

  let photos: RandomPhoto[];
  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[unsplash] ${response.status} for query "${query}" — reserve not topped up`);
      return [];
    }
    const body = await response.json();
    if (!Array.isArray(body)) {
      // eslint-disable-next-line no-console
      console.warn('[unsplash] unexpected body shape — reserve not topped up');
      return [];
    }
    photos = body as RandomPhoto[];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[unsplash] request failed — reserve not topped up', error);
    return [];
  }

  return photos.flatMap((photo) => {
    const url = normalizeUrl(photo.urls?.raw ?? '');
    if (!url) {
      return [];
    }
    const profile = photo.user?.links?.html ?? 'https://unsplash.com';
    return [
      {
        url,
        creditName: photo.user?.name ?? 'Unsplash',
        creditUrl: `${profile}?${UTM}`,
        downloadLocation: photo.links?.download_location ?? null,
      },
    ];
  });
}
