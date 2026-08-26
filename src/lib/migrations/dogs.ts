import type { Migration } from './runner';

// Migration registry for the DOGS-TEACHER database (dogs-db.ts) — a separate
// physical database (DOGS_DATABASE_URL), so it keeps its own registry and its
// own schema_migrations journal. Same rules as main.ts: append-only, applied
// sql is frozen.

const baselineSql = `
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
    personal_data_consent_at TIMESTAMPTZ,
    personal_data_consent_version TEXT,
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

  CREATE TABLE IF NOT EXISTS dogs_push_subscriptions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES dogs_clients(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS dogs_push_subscriptions_client_id_idx
    ON dogs_push_subscriptions (client_id);
`;

export const DOGS_MIGRATIONS: Migration[] = [
  { id: '0001_baseline', sql: baselineSql },
  {
    // dogs_clients.email shipped after the table did — legacy prod tables need
    // the explicit ADD COLUMN (baseline's CREATE TABLE is a no-op for them).
    // Required by getClientPortal / listAdminBookings selects.
    id: '0002_dogs_clients_email',
    sql: 'ALTER TABLE dogs_clients ADD COLUMN IF NOT EXISTS email TEXT',
  },
  {
    // At-most-once claim flag for the lesson reminder scheduler
    // (src/services/dogs-reminders.ts). NULL = reminder not sent yet.
    id: '0003_dogs_booking_requests_reminder_sent_at',
    sql: 'ALTER TABLE dogs_booking_requests ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ',
  },
  {
    // 152-ФЗ consent proof, NULL on rows predating the consent checkbox
    // (2026-08-01). Load-bearing: every booking INSERT references these —
    // strict, so a failure aborts startup instead of a warn line nobody reads
    // (dogs-db.ts additionally re-verifies the columns after migrating).
    id: '0004_dogs_booking_requests_personal_data_consent',
    sql: `
      ALTER TABLE dogs_booking_requests ADD COLUMN IF NOT EXISTS personal_data_consent_at TIMESTAMPTZ;
      ALTER TABLE dogs_booking_requests ADD COLUMN IF NOT EXISTS personal_data_consent_version TEXT;
    `,
  },
  {
    // Slot-uniqueness enforcement (docs/2026-06-30-prod-dogs-slot-dedup.sql
    // cleans the legacy duplicates that block it) — best-effort until then.
    id: '0005_dogs_booking_slots_starts_at_unique',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS dogs_booking_slots_starts_at_unique ON dogs_booking_slots (starts_at)',
    bestEffort: true,
  },
];
