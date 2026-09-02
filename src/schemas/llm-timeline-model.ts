import { z } from 'zod';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// zod's url() accepts any scheme; the frontend puts these into href.
const httpUrl = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL');

export const upsertLlmTimelineModelSchema = z.object({
  slug: z.string().trim().regex(KEBAB, 'slug must be kebab-case').max(200),
  vendor: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  releaseDate: z
    .string()
    .trim()
    .regex(DAY, 'releaseDate must be YYYY-MM-DD')
    .refine((value) => !Number.isNaN(Date.parse(value)), 'releaseDate must be a real day'),
  contextTokens: z.number().int().nonnegative().max(2147483647).nullable().optional(),
  params: z.string().trim().min(1).max(200).nullable().optional(),
  highlight: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(8000),
  capabilities: z.array(z.string().trim().min(1).max(40)).max(16).optional(),
  sourceUrl: httpUrl,
  wikiUrl: httpUrl.nullable().optional(),
  funFact: z.string().trim().min(1).max(2000).nullable().optional(),
});

export const llmTimelineIdParamSchema = z.object({
  id: z.preprocess(
    (value) => (Array.isArray(value) ? value[0] : value),
    z.string().trim().regex(KEBAB, 'id must be kebab-case').max(200)
  ),
});

export type UpsertLlmTimelineModelInput = z.infer<typeof upsertLlmTimelineModelSchema>;
export type LlmTimelineIdParam = z.infer<typeof llmTimelineIdParamSchema>;
