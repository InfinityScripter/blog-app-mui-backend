import '@jest/globals';
import { newDb } from 'pg-mem';
import uuidv4 from '@/src/utils/uuidv4';
import { MAIN_MIGRATIONS } from '@/src/lib/migrations/main';
import { DOGS_MIGRATIONS } from '@/src/lib/migrations/dogs';
import { runMigrations, type Migration } from '@/src/lib/migrations/runner';

function freshPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({ implementation: () => uuidv4(), name: 'gen_random_uuid' });
  return new (db.adapters.createPg().Pool)();
}

describe('runMigrations', () => {
  it('applies pending migrations in order and journals them', async () => {
    const pool = freshPool();
    const migrations: Migration[] = [
      { id: '0001_a', sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY)' },
      { id: '0002_b', sql: "INSERT INTO t1 (id) VALUES ('from-migration')" },
    ];
    await runMigrations(pool, migrations, 'test');

    const journal = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(journal.rows.map((row: { id: string }) => row.id)).toEqual(['0001_a', '0002_b']);
    const rows = await pool.query('SELECT id FROM t1');
    expect(rows.rows).toHaveLength(1);
  });

  it('is idempotent: a second run applies nothing', async () => {
    const pool = freshPool();
    const migrations: Migration[] = [
      { id: '0001_a', sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY)' },
      { id: '0002_b', sql: "INSERT INTO t1 (id) VALUES ('once')" },
    ];
    await runMigrations(pool, migrations, 'test');
    await runMigrations(pool, migrations, 'test');

    // The INSERT migration ran exactly once — the journal, not luck, guarantees it.
    const rows = await pool.query('SELECT id FROM t1');
    expect(rows.rows).toHaveLength(1);
    const journal = await pool.query('SELECT id FROM schema_migrations');
    expect(journal.rows).toHaveLength(2);
  });

  it('applies only the un-applied tail when the registry grows', async () => {
    const pool = freshPool();
    const first: Migration[] = [{ id: '0001_a', sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY)' }];
    await runMigrations(pool, first, 'test');

    const grown: Migration[] = [
      ...first,
      { id: '0002_b', sql: 'CREATE TABLE t2 (id TEXT PRIMARY KEY)' },
    ];
    await runMigrations(pool, grown, 'test');

    const journal = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(journal.rows.map((row: { id: string }) => row.id)).toEqual(['0001_a', '0002_b']);
    await expect(pool.query('SELECT * FROM t2')).resolves.toBeDefined();
  });

  it('a failed strict migration aborts and stays un-journaled', async () => {
    const pool = freshPool();
    const migrations: Migration[] = [
      { id: '0001_a', sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY)' },
      { id: '0002_broken', sql: 'THIS IS NOT SQL' },
      { id: '0003_never', sql: 'CREATE TABLE t3 (id TEXT PRIMARY KEY)' },
    ];
    await expect(runMigrations(pool, migrations, 'test')).rejects.toThrow('0002_broken');

    const journal = await pool.query('SELECT id FROM schema_migrations');
    expect(journal.rows.map((row: { id: string }) => row.id)).toEqual(['0001_a']);
    // 0003 must not have run past the failure.
    await expect(pool.query('SELECT * FROM t3')).rejects.toThrow();
  });

  it('a failed best-effort migration warns, continues, and retries next run', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pool = freshPool();
      const migrations: Migration[] = [
        { id: '0001_broken', sql: 'THIS IS NOT SQL', bestEffort: true },
        { id: '0002_ok', sql: 'CREATE TABLE t2 (id TEXT PRIMARY KEY)' },
      ];
      await runMigrations(pool, migrations, 'test');

      // Un-journaled → eligible for retry; the rest of the tail still applied.
      const journal = await pool.query('SELECT id FROM schema_migrations');
      expect(journal.rows.map((row: { id: string }) => row.id)).toEqual(['0002_ok']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('0001_broken'), expect.anything());

      // "Legacy data cleaned" — the same migration, fixed circumstances, applies now.
      const retry: Migration[] = [
        { id: '0001_broken', sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY)', bestEffort: true },
        migrations[1],
      ];
      await runMigrations(pool, retry, 'test');
      const journal2 = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
      expect(journal2.rows.map((row: { id: string }) => row.id)).toEqual([
        '0001_broken',
        '0002_ok',
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('warns (but does not abort) when an applied migration was edited', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pool = freshPool();
      await runMigrations(pool, [{ id: '0001_a', sql: 'CREATE TABLE t1 (id TEXT)' }], 'test');
      await runMigrations(
        pool,
        [{ id: '0001_a', sql: 'CREATE TABLE t1_edited (id TEXT)' }],
        'test'
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('checksum mismatch'));
      // The edited sql did NOT run.
      await expect(pool.query('SELECT * FROM t1_edited')).rejects.toThrow();
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects an out-of-order or duplicate registry before touching the database', async () => {
    const pool = freshPool();
    await expect(
      runMigrations(
        pool,
        [
          { id: '0002_b', sql: 'SELECT 1' },
          { id: '0001_a', sql: 'SELECT 1' },
        ],
        'test'
      )
    ).rejects.toThrow('out of order');
    await expect(
      runMigrations(
        pool,
        [
          { id: '0001_a', sql: 'SELECT 1' },
          { id: '0001_a', sql: 'SELECT 1' },
        ],
        'test'
      )
    ).rejects.toThrow('duplicate');
  });

  it('the real registries are well-formed and apply cleanly to a fresh database', async () => {
    const mainPool = freshPool();
    await runMigrations(mainPool, MAIN_MIGRATIONS, 'db');
    const mainJournal = await mainPool.query('SELECT id FROM schema_migrations');
    expect(mainJournal.rows.length).toBe(MAIN_MIGRATIONS.length);

    const dogsPool = freshPool();
    await runMigrations(dogsPool, DOGS_MIGRATIONS, 'dogs-db');
    const dogsJournal = await dogsPool.query('SELECT id FROM schema_migrations');
    expect(dogsJournal.rows.length).toBe(DOGS_MIGRATIONS.length);
  });
});
