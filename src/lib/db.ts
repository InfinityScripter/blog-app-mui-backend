import type { QueryResultRow, Pool as NodePool } from 'pg';

import { newDb } from 'pg-mem';
import uuidv4 from '@/src/utils/uuidv4';

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/blog_app';

const schemaSql = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
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
    personal_data_consent_at TIMESTAMPTZ,
    personal_data_consent_version TEXT,
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

  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS personal_data_consent_at TIMESTAMPTZ;

  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS personal_data_consent_version TEXT;

  -- Photographer credit for covers fetched from the Unsplash API — their terms
  -- require naming the author next to the photo. NULL for every other cover
  -- (source images, uploads, the bundled assets and the static stock pool).
  ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS cover_credit_name TEXT;

  ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS cover_credit_url TEXT;

  CREATE TABLE IF NOT EXISTS oauth_consent_challenges (
    token_hash TEXT PRIMARY KEY,
    claim_id TEXT,
    claim_expires_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS oauth_consent_challenges_expires_at_idx
    ON oauth_consent_challenges (expires_at);

  ALTER TABLE oauth_consent_challenges DROP COLUMN IF EXISTS provider;
  ALTER TABLE oauth_consent_challenges DROP COLUMN IF EXISTS provider_user_id;
  ALTER TABLE oauth_consent_challenges DROP COLUMN IF EXISTS email;
  ALTER TABLE oauth_consent_challenges DROP COLUMN IF EXISTS name;
  ALTER TABLE oauth_consent_challenges DROP COLUMN IF EXISTS avatar_url;
  ALTER TABLE oauth_consent_challenges ADD COLUMN IF NOT EXISTS claim_id TEXT;
  ALTER TABLE oauth_consent_challenges ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;

  -- The template's chat_*/kanban_*/calendar_events tables were removed here on
  -- 2026-07-25 together with their routes and services: no frontend ever called
  -- them. This DDL no longer creates them, so fresh environments come up without
  -- them, and prod was dropped by hand the same day (all 8 held 0 rows; dump
  -- kept at /root/backups/dead-tables-20260725-161909.sql on the VDS). Dropping
  -- stays OUT of this file on purpose: schema code runs on every boot, and a
  -- DROP that ships in it would be one bad merge away from deleting a live
  -- table. Any older database still carrying them is cleaned the same way:
  --   DROP TABLE IF EXISTS chat_messages, chat_members, chat_channels,
  --     kanban_tasks, kanban_columns, kanban_board_members, kanban_boards,
  --     calendar_events;

  -- Audit trail of business actions (who/what/when). Append-only.
  -- actor_id keeps the trail when a user is deleted (SET NULL); target_id has
  -- NO FK because the target row is often deleted in the same action. All
  -- indexes are plain btree (no GIN) so this stays pg-mem + boot safe.
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_role TEXT,
    target_type TEXT,
    target_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip TEXT,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx   ON audit_logs (actor_id);
  CREATE INDEX IF NOT EXISTS audit_logs_action_idx     ON audit_logs (action);
  CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at);
  CREATE INDEX IF NOT EXISTS audit_logs_target_idx     ON audit_logs (target_type, target_id);

  CREATE INDEX IF NOT EXISTS posts_publish_idx ON posts (publish);
  CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at);
  CREATE INDEX IF NOT EXISTS posts_user_id_idx ON posts (user_id);
  CREATE INDEX IF NOT EXISTS posts_tags_gin_idx ON posts USING GIN (tags jsonb_path_ops);

  CREATE TABLE IF NOT EXISTS llm_stats_snapshots (
    id TEXT PRIMARY KEY,
    bundle JSONB NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    pushed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- AI model release changelog. TEXT pk + app-side uuidv4 (matches users/posts).
  -- All indexes are plain btree (no GIN) so this stays pg-mem + boot safe.
  CREATE TABLE IF NOT EXISTS model_releases (
    id TEXT PRIMARY KEY,
    vendor TEXT NOT NULL,
    model TEXT NOT NULL,
    version TEXT NOT NULL,
    slug TEXT NOT NULL,
    released_at TIMESTAMPTZ NOT NULL,
    context_tokens INTEGER,
    price_in NUMERIC,
    price_out NUMERIC,
    changes JSONB NOT NULL DEFAULT '[]'::jsonb,
    verdict TEXT,
    source_url TEXT NOT NULL,
    source_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS model_releases_slug_unique ON model_releases (slug);
  CREATE INDEX IF NOT EXISTS model_releases_released_at_idx ON model_releases (released_at DESC);
  CREATE INDEX IF NOT EXISTS model_releases_vendor_idx ON model_releases (vendor);

  -- Newsletter subscribers (double-opt-in). TEXT pk + app-side uuidv4 (matches
  -- users/posts). confirm_token/unsubscribe_token are opaque uuids, never
  -- returned in any API response. All indexes are plain btree (pg-mem + boot safe).
  CREATE TABLE IF NOT EXISTS subscribers (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    confirm_token TEXT,
    confirm_expires_at TIMESTAMPTZ,
    unsubscribe_token TEXT,
    personal_data_consent_at TIMESTAMPTZ,
    personal_data_consent_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_unique ON subscribers (LOWER(email));
  CREATE INDEX IF NOT EXISTS subscribers_status_idx ON subscribers (status);
  CREATE UNIQUE INDEX IF NOT EXISTS subscribers_confirm_token_idx ON subscribers (confirm_token);
  CREATE UNIQUE INDEX IF NOT EXISTS subscribers_unsub_token_idx ON subscribers (unsubscribe_token);

  ALTER TABLE subscribers
    ADD COLUMN IF NOT EXISTS personal_data_consent_at TIMESTAMPTZ;

  ALTER TABLE subscribers
    ADD COLUMN IF NOT EXISTS personal_data_consent_version TEXT;

  -- Refresh tokens for the rotating-refresh auth flow. The raw refresh token
  -- lives only in the httpOnly cookie; only its SHA-256 hash is stored here, so
  -- a DB leak yields no usable tokens. family_id groups a rotation lineage: on
  -- reuse of an already-rotated (revoked) token we revoke the whole family
  -- (theft response). TEXT pk + app-side uuidv4 (matches users/posts).
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    family_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    replaced_by TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_hash_unique ON refresh_tokens (token_hash);
  CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);
  CREATE INDEX IF NOT EXISTS refresh_tokens_family_id_idx ON refresh_tokens (family_id);

  -- Machine-translated post fields (DeepL), cached per (post, language). The
  -- original 'ru' content is never stored here — only translated locales.
  -- post_id has NO FK: translations are a best-effort cache, kept even if the
  -- source post is later deleted (a stale row is harmless and re-derived).
  -- source_hash = sha256 of the original title+description+content; a mismatch
  -- means the source changed, so the cached translation is stale and re-fetched.
  -- status is 'ok' for a real translation, or 'error' when the provider failed
  -- and the read degraded to the original fields. scope records how complete a
  -- row is: 'full' = title+description+content translated (what the details
  -- route writes and the ONLY scope it will serve); 'summary' = title+
  -- description translated, content left as the original (written by the feed
  -- warmup + the list route, which never render a body). A summary row lets a
  -- list show a translated title cheaply without paying to translate the body;
  -- opening the post upgrades it to a full row. All indexes are plain btree
  -- (pg-mem + boot safe).
  CREATE TABLE IF NOT EXISTS post_translations (
    post_id TEXT NOT NULL,
    lang TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    source_hash TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ok',
    scope TEXT NOT NULL DEFAULT 'full',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, lang)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Unsplash photos fetched AHEAD of publishing, so a publish never waits on
  -- api.unsplash.com (see services/cover-reserve.ts). A background job fills
  -- this; createPost claims a row with DELETE ... RETURNING, which is what makes
  -- two concurrent publishes unable to take the same photo. The url IS the
  -- primary key: the same photo can never sit here twice.
  -- download_location is Unsplash's per-photo attribution endpoint, pinged when
  -- the photo is actually claimed (their terms) rather than when it is stashed.
  CREATE TABLE IF NOT EXISTS cover_reserve (
    url TEXT PRIMARY KEY,
    topic TEXT NOT NULL DEFAULT '',
    credit_name TEXT NOT NULL DEFAULT '',
    credit_url TEXT NOT NULL DEFAULT '',
    download_location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS cover_reserve_topic_idx ON cover_reserve (topic);

  -- Personal finance ledger imported from Т-Банк CSV statements (admin-only
  -- dashboard page). flow/bucket/income_source are derived columns: the
  -- classifier recomputes them over the WHOLE table on every import (wash-pair
  -- detection needs neighbouring rows), so they are safe to rewrite. The dedup
  -- unique index makes re-importing an overlapping statement a no-op instead
  -- of doubling history. Plain btree only (pg-mem + boot safe).
  CREATE TABLE IF NOT EXISTS finance_operations (
    id TEXT PRIMARY KEY,
    op_at TIMESTAMPTZ NOT NULL,
    ym TEXT NOT NULL,
    pay_date TEXT NOT NULL DEFAULT '',
    card TEXT NOT NULL DEFAULT '',
    amount NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    bank_category TEXT NOT NULL DEFAULT '',
    mcc TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    cashback NUMERIC NOT NULL DEFAULT 0,
    flow TEXT NOT NULL DEFAULT 'expense' CHECK (flow IN ('income', 'expense', 'internal', 'wash')),
    bucket TEXT NOT NULL DEFAULT '',
    income_source TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS finance_operations_dedup_unique
    ON finance_operations (op_at, amount, description, card);
  CREATE INDEX IF NOT EXISTS finance_operations_ym_idx ON finance_operations (ym);
`;

type PoolLike = NodePool;

/**
 * Best-effort migrations that may legitimately fail against legacy data and
 * must NOT abort startup. The case-insensitive email unique index cannot be
 * created while duplicate emails (differing only by case) still exist in an
 * existing prod table; we attempt it and, on failure, log and continue so the
 * service still boots. Once the duplicates are merged the next restart creates
 * the index. New/clean databases get the index immediately.
 */
async function applySafeMigrations(pool: PoolLike) {
  try {
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email))'
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      '[db] Skipping users_email_lower_unique index (likely duplicate emails differing by case). ' +
        'Merge duplicates, then restart to enforce case-insensitive email uniqueness.',
      error instanceof Error ? error.message : error
    );
  }

  // Add post_translations.scope to pre-existing prod tables (the CREATE TABLE
  // above only adds it to fresh DBs). Idempotent — IF NOT EXISTS. Existing rows
  // were all written by the details route (full-body translations), so the
  // 'full' default correctly classifies the backlog. Wrapped: a legacy Postgres
  // without IF NOT EXISTS support must not abort startup.
  try {
    await pool.query(
      "ALTER TABLE post_translations ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'full'"
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      '[db] Could not ensure post_translations.scope column (older Postgres?).',
      error instanceof Error ? error.message : error
    );
  }

  // NOTE: no post-tagging backfill here. The landing feed (Лента) is common and
  // lists every post; news vs blog is only a per-post distinction (the 'новости'
  // tag, set by the bot) surfaced on /news and /post. Mass-tagging existing
  // posts as news would wrongly pull hand-made blog posts into /news — so each
  // post keeps its own tags exactly as authored.
}

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
    await applySafeMigrations(pool);
    return pool;
  }

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });

  await pool.query(schemaSql);
  await applySafeMigrations(pool);
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
  await pool.query('DELETE FROM subscribers');
  await pool.query('DELETE FROM refresh_tokens');
  await pool.query('DELETE FROM post_translations');
  await pool.query('DELETE FROM app_settings');
  await pool.query('DELETE FROM cover_reserve');
  await pool.query('DELETE FROM finance_operations');
  await pool.query('DELETE FROM users');
}

export default dbConnect;
