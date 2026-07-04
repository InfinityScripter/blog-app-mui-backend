import type { ModelRelease } from '@/src/types/model-release';
import type { ListModelReleasesQuery, CreateModelReleaseInput } from '@/src/schemas/model-release';

import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';
import { slugify } from '@/src/utils/slug';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { MAX_LIMIT } from '@/src/constants/pagination';

// AI model release changelog. Raw dbQuery service mapping snake_case rows to
// the frozen ModelRelease contract (camelCase, ISO timestamps, null for
// unknowns — see src/types/model-release.ts).

interface ModelReleaseRow {
  id: string;
  slug: string;
  vendor: string;
  model: string;
  version: string;
  released_at: Date;
  context_tokens: number | null;
  price_in: string | number | null;
  price_out: string | number | null;
  changes: string[];
  verdict: string | null;
  source_url: string;
  source_name: string | null;
  created_at: Date;
  updated_at: Date;
}

function toIso(value: Date): string {
  return new Date(value).toISOString();
}

// NUMERIC comes back from pg as a string; INTEGER as a number. Normalize to a
// finite number, or null when the column is null (price/context are never invented).
function toNumberOrNull(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapRow(row: ModelReleaseRow): ModelRelease {
  return {
    id: row.id,
    slug: row.slug,
    vendor: row.vendor,
    model: row.model,
    version: row.version,
    releasedAt: toIso(row.released_at),
    contextTokens: toNumberOrNull(row.context_tokens),
    priceIn: toNumberOrNull(row.price_in),
    priceOut: toNumberOrNull(row.price_out),
    changes: Array.isArray(row.changes) ? row.changes : [],
    verdict: row.verdict,
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

async function list(params: ListModelReleasesQuery = {}) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (params.vendor) {
    values.push(params.vendor);
    clauses.push(`vendor = $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);

  const countResult = await dbQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM model_releases ${where}`,
    values
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const rowsResult = await dbQuery<ModelReleaseRow>(
    `SELECT * FROM model_releases ${where} ORDER BY released_at DESC LIMIT $${
      values.length + 1
    } OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  );

  return { releases: rowsResult.rows.map(mapRow), total };
}

async function getBySlug(slug: string): Promise<ModelRelease> {
  const result = await dbQuery<ModelReleaseRow>('SELECT * FROM model_releases WHERE slug = $1', [
    slug,
  ]);
  if (!result.rows.length) {
    throw new AppError(HTTP.NOT_FOUND, 'Model release not found');
  }
  return mapRow(result.rows[0]);
}

async function create(payload: CreateModelReleaseInput): Promise<ModelRelease> {
  const id = uuidv4();
  const slug = payload.slug
    ? slugify(payload.slug)
    : slugify(`${payload.vendor}-${payload.model}-${payload.version}`);

  try {
    const result = await dbQuery<ModelReleaseRow>(
      `INSERT INTO model_releases
         (id, vendor, model, version, slug, released_at, context_tokens,
          price_in, price_out, changes, verdict, source_url, source_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
       RETURNING *`,
      [
        id,
        payload.vendor,
        payload.model,
        payload.version,
        slug,
        payload.releasedAt,
        payload.contextTokens ?? null,
        payload.priceIn ?? null,
        payload.priceOut ?? null,
        JSON.stringify(payload.changes ?? []),
        payload.verdict ?? null,
        payload.sourceUrl,
        payload.sourceName ?? null,
      ]
    );
    return mapRow(result.rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(HTTP.CONFLICT, 'A release with this slug already exists');
    }
    throw error;
  }
}

export const modelReleaseService = { list, getBySlug, create };
