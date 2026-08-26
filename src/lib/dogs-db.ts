import type { QueryResult, QueryResultRow, Pool as NodePool } from 'pg';

import { newDb } from 'pg-mem';
import uuidv4 from '@/src/utils/uuidv4';
import { runMigrations } from '@/src/lib/migrations/runner';
import { DOGS_MIGRATIONS } from '@/src/lib/migrations/dogs';

const DEFAULT_DOGS_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/dogs_teacher';

type PoolLike = NodePool;

// The consent columns are load-bearing: every booking INSERT references them,
// so a silently missing column would 500 the whole public booking flow with
// only a startup warn as the trace. Verify after migrating and refuse to start
// otherwise — a crash is visible, a warn line is not.
async function verifyDogsCriticalColumns(pool: PoolLike) {
  const consentColumns = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'dogs_booking_requests'
       AND column_name IN ('personal_data_consent_at', 'personal_data_consent_version')`
  );
  if (consentColumns.rows.length !== 2) {
    throw new Error(
      '[dogs-db] dogs_booking_requests is missing the personal-data-consent columns after migration'
    );
  }
}

const globalForDogsPostgres = globalThis as typeof globalThis & {
  __dogs_postgres_cache__?:
    | {
        pool: PoolLike | null;
        promise: Promise<PoolLike> | null;
      }
    | undefined;
};

let cached = globalForDogsPostgres.__dogs_postgres_cache__;

if (!cached) {
  cached = { pool: null, promise: null };
  globalForDogsPostgres.__dogs_postgres_cache__ = cached;
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
    await runMigrations(pool, DOGS_MIGRATIONS, 'dogs-db');
    await verifyDogsCriticalColumns(pool);
    return pool;
  }

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DOGS_DATABASE_URL || DEFAULT_DOGS_DATABASE_URL,
  });

  await runMigrations(pool, DOGS_MIGRATIONS, 'dogs-db');
  await verifyDogsCriticalColumns(pool);
  return pool;
}

async function dogsDbConnect() {
  if (cached?.pool) {
    return cached.pool;
  }

  if (!cached?.promise) {
    cached!.promise = createPool();
  }

  cached!.pool = await cached!.promise;
  return cached!.pool;
}

export async function dogsDbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
) {
  const pool = await dogsDbConnect();
  return pool.query<T>(text, params);
}

export type DogsDbTransactionQuery = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<QueryResult<T>>;

// Runs `fn` on one dedicated connection inside BEGIN/COMMIT, issuing ROLLBACK
// on any error before rethrowing it. NOTE: pg-mem (NODE_ENV=test) parses
// transaction statements but executes them as no-ops, so atomicity is only
// enforced on real Postgres — tests can pin the command protocol, not the
// rollback effect.
export async function dogsDbTransaction<T>(
  fn: (query: DogsDbTransactionQuery) => Promise<T>
): Promise<T> {
  const pool = await dogsDbConnect();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn((text, params = []) => client.query(text, params));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Rollback fails only on an already-broken connection; the original
      // error rethrown below is the meaningful one. Log so telemetry can
      // distinguish "clean rollback" from "cleanup also failed".
      // eslint-disable-next-line no-console
      console.warn(
        '[dogs-db] ROLLBACK after a failed transaction also failed.',
        rollbackError instanceof Error ? rollbackError.message : rollbackError
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function resetDogsDatabase() {
  const pool = await dogsDbConnect();
  await pool.query('DELETE FROM dogs_push_subscriptions');
  await pool.query('DELETE FROM dogs_booking_requests');
  await pool.query('DELETE FROM dogs_booking_slots');
  await pool.query('DELETE FROM dogs_clients');
}

export default dogsDbConnect;
