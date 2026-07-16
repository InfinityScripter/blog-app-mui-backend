import type { IPost } from '@/src/models/Post';

const COVER_ASSET_BASE = '/assets/images/cover';

// The blog ships 24 bundled cover images (cover-1.webp … cover-24.webp under
// public/assets/images/cover). Keep this in sync with the bundled asset set.
const COVER_ASSET_COUNT = 24;

// The legacy single default. Every post created without an explicit cover used
// to collapse onto THIS one image, which is why past posts (especially the
// once-daily news-bot batch, whose publisher omits coverUrl) all looked
// identical. Kept as the ultimate fallback and as the value the cover-backfill
// script (scripts/backfill-post-covers.mjs) treats as "an auto-default to
// diversify".
const DEFAULT_POST_COVER_URL = `${COVER_ASSET_BASE}/cover-1.webp`;

/**
 * Deterministically spreads a post across the 24 bundled cover images so posts
 * created WITHOUT an explicit cover no longer all land on cover-1. The mapping
 * is a pure function of `seed` (the post title), so:
 *  - two different posts almost always get different covers (no visible dupes), and
 *  - re-saving the same post never reshuffles its cover (stable, idempotent).
 * An empty/whitespace seed falls back to the legacy default.
 */
function pickDefaultCover(seed?: string): string {
  const key = (seed ?? '').trim();
  if (!key) {
    return DEFAULT_POST_COVER_URL;
  }

  // Polynomial rolling hash (arithmetic only — no bitwise, matching the codebase
  // style). 31 is the classic multiplier; the large prime modulus keeps every
  // intermediate well under Number.MAX_SAFE_INTEGER so the math stays exact.
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 1_000_000_007;
  }

  const index = (hash % COVER_ASSET_COUNT) + 1; // 1 … 24
  return `${COVER_ASSET_BASE}/cover-${index}.webp`;
}

type CoverInput =
  | string
  | null
  | undefined
  | {
      path?: string;
    };

type BuildPostPayloadInput = {
  title?: string;
  publish?: IPost['publish'];
  metaKeywords?: string[] | string;
  content?: string;
  tags?: string[] | string;
  metaTitle?: string;
  coverUrl?: CoverInput;
  totalViews?: number;
  totalShares?: number;
  totalComments?: number;
  totalFavorites?: number;
  metaDescription?: string;
  description?: string;
  favoritePerson?: IPost['favoritePerson'];
};

function parseStringArray(value?: string[] | string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim());
  }

  return value;
}

function resolveCoverUrl(coverUrl?: CoverInput, fallback = DEFAULT_POST_COVER_URL) {
  if (coverUrl === undefined) {
    return undefined;
  }

  if (typeof coverUrl === 'string') {
    return coverUrl;
  }

  return coverUrl?.path ?? fallback;
}

function pickDefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as Partial<T>;
}

export function buildNewPostPayload(
  input: BuildPostPayloadInput,
  author: IPost['author'],
  userId: string
): Partial<IPost> {
  // Seed the varied default on the title so a caller that omits coverUrl (e.g.
  // the news bot) gets a spread-out cover instead of everyone sharing cover-1.
  const defaultCover = pickDefaultCover(input.title);
  return {
    title: input.title,
    publish: input.publish,
    metaKeywords: parseStringArray(input.metaKeywords) || [],
    content: input.content,
    tags: parseStringArray(input.tags) || [],
    metaTitle: input.metaTitle,
    coverUrl: resolveCoverUrl(input.coverUrl, defaultCover) || defaultCover,
    totalViews: input.totalViews || 0,
    totalShares: input.totalShares || 0,
    totalComments: input.totalComments || 0,
    totalFavorites: input.totalFavorites || 0,
    metaDescription: input.metaDescription,
    description: input.description,
    author,
    userId,
    favoritePerson: input.favoritePerson || [],
  };
}

export function buildPostPatchPayload(
  input: BuildPostPayloadInput,
  options: {
    author?: IPost['author'];
    coverUrlFallback?: string;
    totalComments?: number;
  } = {}
) {
  return pickDefined({
    title: input.title,
    publish: input.publish,
    metaKeywords:
      input.metaKeywords !== undefined ? parseStringArray(input.metaKeywords) || [] : undefined,
    content: input.content,
    tags: input.tags !== undefined ? parseStringArray(input.tags) || [] : undefined,
    metaTitle: input.metaTitle,
    coverUrl:
      input.coverUrl !== undefined
        ? resolveCoverUrl(input.coverUrl, options.coverUrlFallback)
        : undefined,
    totalViews: input.totalViews,
    totalShares: input.totalShares,
    totalComments: options.totalComments,
    totalFavorites: input.totalFavorites,
    metaDescription: input.metaDescription,
    description: input.description,
    author: options.author,
    favoritePerson: input.favoritePerson,
  });
}

export { pickDefaultCover, COVER_ASSET_BASE, COVER_ASSET_COUNT, DEFAULT_POST_COVER_URL };
