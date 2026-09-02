import type { QueryResultRow, Pool as NodePool } from 'pg';

import { newDb } from 'pg-mem';
import uuidv4 from '@/src/utils/uuidv4';
import { runMigrations } from '@/src/lib/migrations/runner';
import { MAIN_MIGRATIONS } from '@/src/lib/migrations/main';

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/blog_app';

// The schema lives in src/lib/migrations/main.ts as a versioned, append-only
// registry; every boot applies the un-applied tail via runMigrations (journal
// table: schema_migrations). See docs/ARCHITECTURE.md → Schema management.

type PoolLike = NodePool;

const globalForPostgres = globalThis as typeof globalThis & {
  __postgres_cache__?:
    | {
        pool: PoolLike | null;
        promise: Promise<PoolLike> | null;
      }
    | undefined;
};

let cached = globalForPostgres.__postgres_cache__;

if (!cached) {
  cached = { pool: null, promise: null };
  globalForPostgres.__postgres_cache__ = cached;
}

async function createPool(): Promise<PoolLike> {
  if (process.env.NODE_ENV === 'test') {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    db.public.registerFunction({
      implementation: () => uuidv4(),
      name: 'gen_random_uuid',
    });

    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();
    await runMigrations(pool, MAIN_MIGRATIONS, 'db');
    return pool;
  }

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });

  await runMigrations(pool, MAIN_MIGRATIONS, 'db');
  return pool;
}

async function dbConnect() {
  if (cached?.pool) {
    return cached.pool;
  }

  if (!cached?.promise) {
    cached!.promise = createPool();
  }

  cached!.pool = await cached!.promise;
  return cached!.pool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
) {
  const pool = await dbConnect();
  return pool.query<T>(text, params);
}

export async function resetDatabase() {
  const pool = await dbConnect();
  await pool.query('DELETE FROM files');
  await pool.query('DELETE FROM posts');
  await pool.query('DELETE FROM audit_logs');
  await pool.query('DELETE FROM llm_stats_snapshots');
  await pool.query('DELETE FROM model_releases');
  await pool.query('DELETE FROM llm_timeline_models');
  await pool.query('DELETE FROM subscribers');
  await pool.query('DELETE FROM refresh_tokens');
  await pool.query('DELETE FROM post_translations');
  await pool.query('DELETE FROM app_settings');
  await pool.query('DELETE FROM cover_reserve');
  await pool.query('DELETE FROM finance_operations');
  await pool.query('DELETE FROM users');
}

export default dbConnect;
