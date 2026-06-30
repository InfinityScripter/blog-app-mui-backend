import type { QueryResultRow, Pool as NodePool } from 'pg';

import { newDb } from 'pg-mem';
import uuidv4 from '@/src/utils/uuidv4';

const DEFAULT_DOGS_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/dogs_teacher';

const dogsSchemaSql = `
  CREATE TABLE IF NOT EXISTS dogs_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    phone_normalized TEXT NOT NULL UNIQUE,
    email TEXT,
    access_token TEXT NOT NULL UNIQUE,
    telegram_user_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS dogs_booking_slots (
    id TEXT PRIMARY KEY,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
  );

  CREATE INDEX IF NOT EXISTS dogs_booking_slots_active_starts_at_idx
    ON dogs_booking_slots (is_active, starts_at);

  CREATE TABLE IF NOT EXISTS dogs_booking_requests (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES dogs_clients(id) ON DELETE CASCADE,
    slot_id TEXT NOT NULL REFERENCES dogs_booking_slots(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL,
    dog TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
    source TEXT NOT NULL DEFAULT 'site' CHECK (source IN ('site', 'telegram')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS dogs_booking_requests_client_id_idx
    ON dogs_booking_requests (client_id);
  CREATE INDEX IF NOT EXISTS dogs_booking_requests_status_idx
    ON dogs_booking_requests (status);
  CREATE INDEX IF NOT EXISTS dogs_booking_requests_slot_id_idx
    ON dogs_booking_requests (slot_id);
  CREATE UNIQUE INDEX IF NOT EXISTS dogs_booking_requests_active_slot_unique
    ON dogs_booking_requests (slot_id)
    WHERE status IN ('pending', 'confirmed');
`;

type PoolLike = NodePool;

/**
 * Best-effort migration that may legitimately fail against legacy data and must
 * NOT abort startup. The UNIQUE index on starts_at cannot be created while
 * duplicate slot rows still exist on an existing prod table; we attempt it and,
 * on failure, log and continue so the service still boots. Once the duplicates
 * are cleaned (see docs/2026-06-30-prod-dogs-slot-dedup.sql) the next restart
 * creates the index. New/clean databases get it immediately, which makes the
 * createSlot/createSlots ON CONFLICT (starts_at) dedup effective.
 */
async function applyDogsSafeMigrations(pool: PoolLike) {
  try {
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS dogs_booking_slots_starts_at_unique ON dogs_booking_slots (starts_at)'
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      '[dogs-db] Skipping dogs_booking_slots_starts_at_unique index (likely duplicate slot start times). ' +
        'Clean duplicates, then restart to enforce slot uniqueness.',
      error instanceof Error ? error.message : error
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
    await pool.query(dogsSchemaSql);
    await applyDogsSafeMigrations(pool);
    return pool;
  }

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DOGS_DATABASE_URL || DEFAULT_DOGS_DATABASE_URL,
  });

  await pool.query(dogsSchemaSql);
  await applyDogsSafeMigrations(pool);
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

export async function resetDogsDatabase() {
  const pool = await dogsDbConnect();
  await pool.query('DELETE FROM dogs_booking_requests');
  await pool.query('DELETE FROM dogs_booking_slots');
  await pool.query('DELETE FROM dogs_clients');
}

export default dogsDbConnect;
