import { z } from 'zod';

// Request body schemas for the post endpoints. The payload builders
// (utils/post-payload.ts) already whitelist WHICH fields reach the DB; these
// schemas guarantee the TYPES at the HTTP boundary, so a numeric title or an
// object in `tags` never reaches the builder/service.

/** CSV string ("ai,новости") or array — post-payload's parseStringArray takes both.
 * null is accepted where the pre-zod code tolerated it: a null patch value
 * historically cleared the field to [] in the payload builder. */
const stringArrayOrCsv = z.union([z.array(z.string()), z.string(), z.null()]);

const publishField = z.enum(['draft', 'published']);

/** Cover location: http(s) URL, site-relative path, empty string ("no cover" —
 * the payload builder falls back), explicit null, or the upload-widget object.
 * The refine shuts the stored-XSS door: a `javascript:`/`data:` value would be
 * rendered into the post card's image URL as-is. */
const coverLocation = z
  .string()
  .refine(
    (value) => value.trim() === '' || /^https?:\/\//i.test(value) || value.startsWith('/'),
    'coverUrl must be an http(s) URL or a site-relative path'
  );
const coverField = z.union([coverLocation, z.null(), z.object({ path: coverLocation.optional() })]);

const favoritePersonField = z.array(z.object({ name: z.string(), avatarUrl: z.string() }));

// Shared field set of the create/patch payload (everything optional here;
// create tightens what it requires below). Unknown keys are stripped by zod,
// which matches the builders' whitelist behavior.
const postFields = z.object({
  title: z.string().trim().min(1),
  publish: publishField,
  metaKeywords: stringArrayOrCsv,
  content: z.string(),
  tags: stringArrayOrCsv,
  metaTitle: z.string(),
  coverUrl: coverField,
  // Счётчики (totalViews/Shares/Comments/Favorites) НАМЕРЕННО не в схеме:
  // zod их молча вырезает из тела, так что владелец поста не может накрутить
  // себе просмотры через edit. Счётчиками управляют свои механизмы:
  // просмотры — POST /api/post/[id]/view, totalComments — comment-сервис.
  metaDescription: z.string(),
  description: z.string(),
  favoritePerson: favoritePersonField,
});

/** POST /api/post/new — title is the only hard requirement (news bot omits content). */
export const newPostSchema = postFields.partial().required({ title: true });

/** PATCH/PUT /api/post/[id]/edit and admin PUT /api/admin/posts/[id]. */
export const editPostSchema = postFields.partial();

/** /api/post/[id]/publish — service re-checks, this moves the 400 to the boundary. */
export const setPublishSchema = z.object({ publish: publishField });

// Comment bodies (/api/post/[id]/comments) — one schema per method.

// nullish (not optional): clients serialize "absent" as explicit null
// (e.g. { parentCommentId: null } for a top-level comment), and the pre-zod
// handlers tolerated that — `if (!parentCommentId)`, `tagUser || undefined`.
export const addCommentSchema = z.object({
  message: z.string().trim().min(1),
  parentCommentId: z.string().nullish(),
  tagUser: z.string().nullish(),
});

export const editCommentSchema = z.object({
  commentId: z.string().min(1),
  message: z.string().trim().min(1),
  isReply: z.boolean().nullish(),
  parentCommentId: z.string().nullish(),
});

export const deleteCommentSchema = z.object({
  commentId: z.string().min(1),
  isReply: z.boolean().nullish(),
  parentCommentId: z.string().nullish(),
});

export type NewPostBody = z.infer<typeof newPostSchema>;
export type EditPostBody = z.infer<typeof editPostSchema>;

// ----------------------------------------------------------------------
// Query schemas for the public post read routes. Values stay STRINGS — the
// handlers keep their existing parsing/clamping (parsePositiveInt, parseLang);
// the schema's job is to reject malformed shapes (arrays via ?page=1&page=2,
// non-digit page numbers) with a 400 instead of silently coercing them.
// Unknown query keys (utm_* tracking tails and the like) are stripped, not
// rejected.

/** Digits-only string; the handler still clamps the parsed number. */
const digitString = z.string().regex(/^\d+$/, 'must be a positive integer');

/** parseLang narrows unknown values to the default locale itself. */
const langQuery = z.string().optional();

export const postListQuerySchema = z.object({
  page: digitString.optional(),
  limit: digitString.optional(),
  tag: z.string().optional(),
  excludeTag: z.string().optional(),
  lang: langQuery,
});

export const postSearchQuerySchema = z.object({
  query: z.string().optional(),
  dashboard: z.enum(['true', 'false']).optional(),
  lang: langQuery,
});

export const postDetailsQuerySchema = z.object({
  id: z.string().min(1),
  lang: langQuery,
});

export const postLatestQuerySchema = z.object({
  title: z.string().trim().min(1),
  lang: langQuery,
});
