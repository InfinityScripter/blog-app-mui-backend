import '@jest/globals';
import { newDb } from 'pg-mem';

// Regression guard for the prod incident where dogs_clients.email was added to
// the CREATE TABLE literal only — which is a no-op for an already-provisioned
// table, so the column never landed and every `c.email` SELECT 500'd. The fix
// adds an idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS email` migration.
// These tests prove that statement (a) adds the column to a legacy table that
// lacks it, and (b) is a safe no-op when the column already exists.

const ADD_EMAIL = 'ALTER TABLE dogs_clients ADD COLUMN IF NOT EXISTS email TEXT';

function hasColumn(db: ReturnType<typeof newDb>, table: string, column: string) {
  const rows = db.public.many(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = '${table}' AND column_name = '${column}'`
  );
  return rows.length === 1;
}

describe('dogs_clients email migration', () => {
  it('adds the email column to a legacy table created without it', () => {
    const db = newDb();
    // Simulate the prod table as it existed BEFORE the email feature.
    db.public.none(`
      CREATE TABLE dogs_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL
      );
    `);
    expect(hasColumn(db, 'dogs_clients', 'email')).toBe(false);

    db.public.none(ADD_EMAIL);

    expect(hasColumn(db, 'dogs_clients', 'email')).toBe(true);
  });

  it('is an idempotent no-op when the email column already exists', () => {
    const db = newDb();
    db.public.none(`
      CREATE TABLE dogs_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      );
    `);

    // Running it twice must not throw.
    db.public.none(ADD_EMAIL);
    db.public.none(ADD_EMAIL);

    expect(hasColumn(db, 'dogs_clients', 'email')).toBe(true);
  });
});
