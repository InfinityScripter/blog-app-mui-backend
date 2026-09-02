import type { LlmTimelineModel } from '@/src/types/llm-timeline-model';
import type { UpsertLlmTimelineModelInput } from '@/src/schemas/llm-timeline-model';

import { dbQuery } from '@/src/lib/db';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { isUniqueViolation } from '@/src/utils/pg-errors';

interface LlmTimelineModelRow {
  id: string;
  slug: string;
  vendor: string;
  name: string;
  release_date: string;
  context_tokens: number | null;
  params: string | null;
  highlight: string;
  description: string;
  capabilities: string[];
  source_url: string;
  wiki_url: string | null;
  fun_fact: string | null;
  created_at: Date;
  updated_at: Date;
}

function toIso(value: Date): string {
  return new Date(value).toISOString();
}

function mapRow(row: LlmTimelineModelRow): LlmTimelineModel {
  return {
    id: row.id,
    slug: row.slug,
    vendor: row.vendor,
    name: row.name,
    releaseDate: row.release_date,
    contextTokens: row.context_tokens,
    params: row.params,
    highlight: row.highlight,
    description: row.description,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    sourceUrl: row.source_url,
    wikiUrl: row.wiki_url,
    funFact: row.fun_fact,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function list(): Promise<LlmTimelineModel[]> {
  const result = await dbQuery<LlmTimelineModelRow>(
    'SELECT * FROM llm_timeline_models ORDER BY release_date ASC, id ASC'
  );
  return result.rows.map(mapRow);
}

// UPDATE first, INSERT if nothing matched: one writer (the job), so no race
// to guard; ON CONFLICT would also need xmax tricks to report created/updated.
async function upsert(
  id: string,
  payload: UpsertLlmTimelineModelInput
): Promise<{ model: LlmTimelineModel; created: boolean }> {
  const values = [
    id,
    payload.slug,
    payload.vendor,
    payload.name,
    payload.releaseDate,
    payload.contextTokens ?? null,
    payload.params ?? null,
    payload.highlight,
    payload.description,
    JSON.stringify(payload.capabilities ?? []),
    payload.sourceUrl,
    payload.wikiUrl ?? null,
    payload.funFact ?? null,
  ];
  try {
    const updated = await dbQuery<LlmTimelineModelRow>(
      `UPDATE llm_timeline_models
         SET slug = $2, vendor = $3, name = $4, release_date = $5, context_tokens = $6,
             params = $7, highlight = $8, description = $9, capabilities = $10::jsonb,
             source_url = $11, wiki_url = $12, fun_fact = $13, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      values
    );
    if (updated.rows[0]) {
      return { model: mapRow(updated.rows[0]), created: false };
    }
    const inserted = await dbQuery<LlmTimelineModelRow>(
      `INSERT INTO llm_timeline_models
         (id, slug, vendor, name, release_date, context_tokens, params, highlight,
          description, capabilities, source_url, wiki_url, fun_fact)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
       RETURNING *`,
      values
    );
    return { model: mapRow(inserted.rows[0]), created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(HTTP.CONFLICT, 'Another timeline model already uses this slug');
    }
    throw error;
  }
}

async function remove(id: string): Promise<void> {
  const result = await dbQuery<{ id: string }>(
    'DELETE FROM llm_timeline_models WHERE id = $1 RETURNING id',
    [id]
  );
  if (result.rows.length === 0) {
    throw new AppError(HTTP.NOT_FOUND, 'Timeline model not found');
  }
}

export const llmTimelineModelService = { list, upsert, remove };
