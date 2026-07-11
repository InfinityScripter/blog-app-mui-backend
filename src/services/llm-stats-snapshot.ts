import { dbQuery } from '@/src/lib/db';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';

// Business logic for the local-pushed LLM-usage snapshot. The bundle is an
// opaque JSON object computed on the developer's machine (token/model/harness
// aggregates with project names already stripped) and stored as-is. Only the
// latest snapshot is kept — a single row with a fixed id.

const LATEST_ID = 'latest';

export interface SnapshotResult {
  bundle: unknown | null;
  pushedAt: string | null;
}

function isPlausibleBundle(value: unknown): value is { meta: { generatedAt: string } } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!('kpis' in v) || !('meta' in v)) return false;
  const { meta } = v;
  return (
    !!meta &&
    typeof meta === 'object' &&
    typeof (meta as Record<string, unknown>).generatedAt === 'string'
  );
}

export async function saveSnapshot(bundle: unknown): Promise<{ pushedAt: string }> {
  if (!isPlausibleBundle(bundle)) {
    throw new AppError(HTTP.BAD_REQUEST, 'Invalid stats bundle');
  }
  const { generatedAt } = bundle.meta;
  const rows = await dbQuery<{ pushed_at: string }>(
    `INSERT INTO llm_stats_snapshots (id, bundle, generated_at, pushed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE
       SET bundle = EXCLUDED.bundle,
           generated_at = EXCLUDED.generated_at,
           pushed_at = NOW()
     RETURNING pushed_at`,
    [LATEST_ID, JSON.stringify(bundle), generatedAt]
  );
  return { pushedAt: rows.rows[0].pushed_at };
}

export async function getLatestSnapshot(): Promise<SnapshotResult> {
  const rows = await dbQuery<{ bundle: unknown; pushed_at: string }>(
    'SELECT bundle, pushed_at FROM llm_stats_snapshots WHERE id = $1',
    [LATEST_ID]
  );
  if (!rows.rows.length) {
    return { bundle: null, pushedAt: null };
  }
  return { bundle: rows.rows[0].bundle, pushedAt: rows.rows[0].pushed_at };
}
