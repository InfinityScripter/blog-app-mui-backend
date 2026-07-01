import { z } from 'zod';

const dateTimeSchema = z.string().trim().datetime({ offset: true });

const nullableNumber = z.number().nullable().optional();

const queryStringSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}, z.string().trim().min(1).optional());

const queryIntSchema = z.preprocess((value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : raw;
}, z.number().int().min(0).optional());

// Mirrors CreateReleasePayload (§3): vendor/model/version/releasedAt/sourceUrl
// required; slug/context/prices/changes/verdict/sourceName optional. changes
// defaults to []. context and prices are nullable (never invented → null).
export const createModelReleaseSchema = z.object({
  vendor: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(160),
  version: z.string().trim().min(1).max(120),
  releasedAt: dateTimeSchema,
  sourceUrl: z.string().trim().url().max(2000),
  slug: z.string().trim().min(1).max(200).optional(),
  contextTokens: z.number().int().nonnegative().max(2147483647).nullable().optional(),
  priceIn: nullableNumber,
  priceOut: nullableNumber,
  changes: z.array(z.string()).default([]),
  verdict: z.string().trim().max(2000).nullable().optional(),
  sourceName: z.string().trim().max(200).nullable().optional(),
});

export const listModelReleasesQuerySchema = z.object({
  vendor: queryStringSchema,
  limit: queryIntSchema,
  offset: queryIntSchema,
});

export const slugParamSchema = z.object({
  slug: z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }, z.string().trim().min(1).max(200)),
});

export type CreateModelReleaseInput = z.infer<typeof createModelReleaseSchema>;
export type ListModelReleasesQuery = z.infer<typeof listModelReleasesQuerySchema>;
export type SlugParam = z.infer<typeof slugParamSchema>;
