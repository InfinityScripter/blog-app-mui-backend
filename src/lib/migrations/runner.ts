import type { Pool as NodePool } from 'pg';

import { createHash } from 'node:crypto';

// ----------------------------------------------------------------------
// Versioned, forward-only SQL migrations (replaces the boot-time
// "run the whole idempotent schemaSql" approach — bug-class audit item 3.2).
//
// Model (the standard production pattern, Flyway-style):
//   - every schema change is a numbered Migration in a per-database registry
//     (migrations/main.ts, migrations/dogs.ts); registries are append-only and
//     an applied migration's sql is frozen — a change to history is a bug the
//     checksum warning surfaces, never something the runner re-executes;
//   - a `schema_migrations` journal in each database records what has been
//     applied (id + sha256 checksum + timestamp), so every boot applies only
//     the missing tail, in order, inside a transaction, under an advisory
//     lock (so two concurrently starting instances cannot race);
//   - a failed strict migration aborts startup (a crash is visible, a warn
//     line is not); a `bestEffort` migration may legitimately fail against
//     legacy prod data (e.g. a unique index over still-dirty rows) — it logs,
//     stays un-journaled and is retried on the next boot, exactly the
//     semantics the old applySafeMigrations gave those steps.
//
// pg-mem (NODE_ENV=test) caveats, both fine for tests: it has no advisory
// locks (the lock acquire is try/catch'd away) and parses BEGIN/COMMIT as
// no-ops (atomicity is only enforced on real Postgres — but the journal INSERT
// runs after the migration sql, so "failed sql ⇒ not journaled" holds anyway).

export interface Migration {
  /** Ordered unique id, `NNNN_snake_name` (e.g. '0002_users_email_lower_unique'). */
  id: string;
  /** The migration's SQL. Frozen once applied anywhere — append a new migration instead. */
  sql: string;
  /**
   * May fail against legacy data without aborting startup: logged, left out of
   * the journal, retried next boot. Reserve for steps whose failure leaves the
   * app functional (an enforcement index over possibly-dirty prod rows).
   */
  bestEffort?: boolean;
}

type PoolLike = Pick<NodePool, 'connect'>;

const JOURNAL_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Stable 31-bit advisory-lock key from the registry label (same rolling hash family as coverSeed). */
function lockKeyOf(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) % 2_147_483_647;
  }
  return hash;
}

/** Throws when the registry is unordered or has duplicate ids — a registry
 * authoring bug that must fail loudly before any SQL runs. */
function assertRegistryShape(migrations: Migration[], label: string) {
  const seen = new Set<string>();
  let previous = '';
  migrations.forEach((migration) => {
    if (seen.has(migration.id)) {
      throw new Error(`[${label}] duplicate migration id: ${migration.id}`);
    }
    if (migration.id <= previous) {
      throw new Error(
        `[${label}] migration registry out of order: ${migration.id} after ${previous}`
      );
    }
    seen.add(migration.id);
    previous = migration.id;
  });
}

type ClientLike = Awaited<ReturnType<PoolLike['connect']>>;

/** Applies one migration transactionally and journals it. A best-effort
 * failure warns and leaves it un-journaled (retried next boot); a strict
 * failure aborts startup. */
async function applyOne(client: ClientLike, migration: Migration, label: string) {
  try {
    await client.query('BEGIN');
    await client.query(migration.sql);
    await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [
      migration.id,
      checksumOf(migration.sql),
    ]);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection already broken — the original error below is the story.
    }
    if (migration.bestEffort) {
      // eslint-disable-next-line no-console
      console.warn(
        `[${label}] best-effort migration ${migration.id} failed; will retry next boot.`,
        error instanceof Error ? error.message : error
      );
      return;
    }
    throw new Error(
      `[${label}] migration ${migration.id} failed — refusing to start: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function runMigrations(pool: PoolLike, migrations: Migration[], label: string) {
  assertRegistryShape(migrations, label);

  const client = await pool.connect();
  let locked = false;
  try {
    try {
      await client.query('SELECT pg_advisory_lock($1)', [lockKeyOf(label)]);
      locked = true;
    } catch {
      // pg-mem implements no advisory locks; tests are single-writer anyway.
    }

    // Guarded create instead of a bare IF NOT EXISTS: pg-mem raises
    // "Not supported" when it re-parses an IF NOT EXISTS CREATE for a table
    // that already exists (real Postgres no-ops it). One schema per database
    // here, so the name-only lookup is unambiguous.
    const journalExists = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'"
    );
    if (journalExists.rows.length === 0) {
      await client.query(JOURNAL_SQL);
    }
    const journal = await client.query('SELECT id, checksum FROM schema_migrations');
    const applied = new Map<string, string>(
      journal.rows.map((row: { id: string; checksum: string }) => [row.id, row.checksum])
    );

    // Sequential by design: each migration may depend on every earlier one, so
    // ordering IS the correctness property (same idiom as cover-reserve.ts).
    for (let i = 0; i < migrations.length; i += 1) {
      const migration = migrations[i];
      const appliedChecksum = applied.get(migration.id);
      if (appliedChecksum === undefined) {
        // eslint-disable-next-line no-await-in-loop
        await applyOne(client, migration, label);
      } else if (appliedChecksum !== checksumOf(migration.sql)) {
        // Warn, don't abort: the running app is not the place to resolve a
        // history edit, and refusing to boot would take prod down over it.
        // eslint-disable-next-line no-console
        console.warn(
          `[${label}] migration ${migration.id} was edited after being applied ` +
            '(checksum mismatch). Applied SQL stays as it ran; append a new migration instead.'
        );
      }
    }
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKeyOf(label)]).catch(() => {});
    }
    client.release();
  }
}
