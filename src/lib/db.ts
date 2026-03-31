import type { QueryResultRow, Pool as NodePool } from 'pg';

import { newDb } from 'pg-mem';
import uuidv4 from '@/src/utils/uuidv4';

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/blog_app';

const schemaSql = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    yandex_id TEXT UNIQUE,
    avatar_url TEXT,
    is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    email_verification_code TEXT,
    email_verification_expires TIMESTAMPTZ,
    password_reset_code TEXT,
    password_reset_expires TIMESTAMPTZ,
    last_login TIMESTAMPTZ,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    publish TEXT NOT NULL DEFAULT 'draft' CHECK (publish IN ('draft', 'published')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    meta_title TEXT NOT NULL DEFAULT '',
    meta_description TEXT NOT NULL DEFAULT '',
    meta_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_views INTEGER NOT NULL DEFAULT 0,
    total_shares INTEGER NOT NULL DEFAULT 0,
    total_comments INTEGER NOT NULL DEFAULT 0,
    total_favorites INTEGER NOT NULL DEFAULT 0,
    favorite_person JSONB NOT NULL DEFAULT '[]'::jsonb,
    comments JSONB NOT NULL DEFAULT '[]'::jsonb,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    originalname TEXT NOT NULL,
    mimetype TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BYTEA NOT NULL,
    upload_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS yandex_id TEXT;

  CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique
    ON users (google_id)
    WHERE google_id IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS users_yandex_id_unique
    ON users (yandex_id)
    WHERE yandex_id IS NOT NULL;

  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

  CREATE TABLE IF NOT EXISTS chat_channels (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS kanban_boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS kanban_board_members (
    board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (board_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS kanban_columns (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS kanban_tasks (
    id TEXT PRIMARY KEY,
    column_id TEXT NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    assignees JSONB NOT NULL DEFAULT '[]'::jsonb,
    labels JSONB NOT NULL DEFAULT '[]'::jsonb,
    due_date TIMESTAMPTZ,
    position INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT 'primary',
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    all_day BOOLEAN NOT NULL DEFAULT FALSE,
    type TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

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
    await pool.query(schemaSql);
    return pool;
  }

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });

  await pool.query(schemaSql);
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
  await pool.query('DELETE FROM calendar_events');
  await pool.query('DELETE FROM kanban_tasks');
  await pool.query('DELETE FROM kanban_columns');
  await pool.query('DELETE FROM kanban_board_members');
  await pool.query('DELETE FROM kanban_boards');
  await pool.query('DELETE FROM chat_messages');
  await pool.query('DELETE FROM chat_members');
  await pool.query('DELETE FROM chat_channels');
  await pool.query('DELETE FROM files');
  await pool.query('DELETE FROM posts');
  await pool.query('DELETE FROM users');
}

export default dbConnect;
