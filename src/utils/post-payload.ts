import type { IPost } from '@/src/models/Post';

const DEFAULT_POST_COVER_URL = '/assets/images/cover/cover-1.webp';

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
  return {
    title: input.title,
    publish: input.publish,
    metaKeywords: parseStringArray(input.metaKeywords) || [],
    content: input.content,
    tags: parseStringArray(input.tags) || [],
    metaTitle: input.metaTitle,
    coverUrl: resolveCoverUrl(input.coverUrl, DEFAULT_POST_COVER_URL) || DEFAULT_POST_COVER_URL,
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

export { DEFAULT_POST_COVER_URL };
