import { z } from 'zod';

// Request body schemas for the post endpoints. The payload builders
// (utils/post-payload.ts) already whitelist WHICH fields reach the DB; these
// schemas guarantee the TYPES at the HTTP boundary, so a numeric title or an
// object in `tags` never reaches the builder/service.

/** CSV string ("ai,новости") or array — post-payload's parseStringArray takes both. */
const stringArrayOrCsv = z.union([z.array(z.string()), z.string()]);

const publishField = z.enum(['draft', 'published']);

/** Plain URL string, explicit null, or the upload-widget object ({ path }). */
const coverField = z.union([z.string(), z.null(), z.object({ path: z.string().optional() })]);

const countField = z.number().int().nonnegative();

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
  totalViews: countField,
  totalShares: countField,
  totalComments: countField,
  totalFavorites: countField,
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

export const addCommentSchema = z.object({
  message: z.string().trim().min(1),
  parentCommentId: z.string().optional(),
  tagUser: z.string().optional(),
});

export const editCommentSchema = z.object({
  commentId: z.string().min(1),
  message: z.string().trim().min(1),
  isReply: z.boolean().optional(),
  parentCommentId: z.string().optional(),
});

export const deleteCommentSchema = z.object({
  commentId: z.string().min(1),
  isReply: z.boolean().optional(),
  parentCommentId: z.string().optional(),
});

export type NewPostBody = z.infer<typeof newPostSchema>;
export type EditPostBody = z.infer<typeof editPostSchema>;
