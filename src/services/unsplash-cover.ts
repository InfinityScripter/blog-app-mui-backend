import { topicFor } from '@/src/utils/cover-pool';

// Unsplash is the OPEN-ENDED cover source: the static pool is finite (≈120
// images at ~2 auto-covered posts a day it runs out in weeks), and once it is
// drained covers start repeating again — the exact problem this whole mechanism
// exists to kill. With a key configured every post gets a photo nobody used
// before. Without a key this module is a no-op and the static ladder takes over,
// so the blog keeps working with no configuration at all.
const RANDOM_URL = 'https://api.unsplash.com/photos/random';

// This call sits on the SYNCHRONOUS publish path: "Создать пост" (and every bot
// publish) waits for it. api.unsplash.com is not reliably reachable — measured
// 2026-07-25, 3 of 5 probes never answered while the ones that did came back in
// ~0.5s — so the budget is what a stalled publish costs, not what a slow reply
// costs. It was 8s, which froze the dashboard for 8 seconds on every unreachable
// attempt. 3s is ~6x the observed good-path latency, and losing the race costs
// nothing but a static-pool cover (still unique, chosen instantly).
const TIMEOUT_MS = 3_000;

// The attribution ping is fire-and-forget, so a slow one delays nobody; keep the
// old, roomier budget there rather than dropping pings Unsplash's terms require.
const ATTRIBUTION_TIMEOUT_MS = 8_000;

// One request returns several candidates so an already-used photo (Unsplash can
// hand back the same popular shot twice) doesn't cost a second round trip.
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

export type UnsplashCover = {
  url: string;
  creditName: string;
  creditUrl: string;
};

type RandomPhoto = {
  urls?: { raw?: string };
  links?: { download_location?: string };
  user?: { name?: string; links?: { html?: string } };
};

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
 */
function triggerDownload(location: string | undefined, accessKey: string) {
  if (!location) {
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
 * Fetches a fresh cover nobody used yet, matched to the post's topic. Returns
 * null — never throws — when the key is missing, the API is unhappy, the body is
 * malformed, or every candidate is already taken; the caller then walks the
 * static pool. Fail-soft is the whole point: a cover is decoration, and an
 * Unsplash outage must not block a publish.
 */
export async function fetchUnsplashCover(
  tags: readonly string[],
  used: ReadonlySet<string>
): Promise<UnsplashCover | null> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    return null;
  }

  const topic = topicFor(tags);
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
      console.warn(`[unsplash] ${response.status} for query "${query}" — using the static pool`);
      return null;
    }
    const body = await response.json();
    if (!Array.isArray(body)) {
      // eslint-disable-next-line no-console
      console.warn('[unsplash] unexpected body shape — using the static pool');
      return null;
    }
    photos = body as RandomPhoto[];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[unsplash] request failed — using the static pool', error);
    return null;
  }

  // First candidate that normalizes AND is not already on a post. Unsplash can
  // hand back a photo we used months ago; without this check it would slip
  // through and the whole point of the mechanism would be lost.
  const free = photos
    .map((photo) => ({ photo, url: normalizeUrl(photo.urls?.raw ?? '') }))
    .find((entry) => entry.url !== null && !used.has(entry.url));
  if (!free || !free.url) {
    return null;
  }

  triggerDownload(free.photo.links?.download_location, accessKey);
  const profile = free.photo.user?.links?.html ?? 'https://unsplash.com';
  return {
    url: free.url,
    creditName: free.photo.user?.name ?? 'Unsplash',
    creditUrl: `${profile}?${UTM}`,
  };
}
