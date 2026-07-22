import type { Subscriber, SubscriberStatus } from '@/src/types/subscriber';

import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';

// Newsletter subscribers (double-opt-in). Raw dbQuery service mapping snake_case
// rows to the frozen Subscriber contract (camelCase, ISO timestamps — see
// src/types/subscriber.ts). Tokens (confirm_token / unsubscribe_token /
// confirm_expires_at) are secret and are NEVER mapped into the returned DTO.

interface SubscriberRow {
  id: string;
  email: string;
  status: string;
  confirm_token: string | null;
  confirm_expires_at: Date | null;
  unsubscribe_token: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

// 24h double-opt-in confirm window.
const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

function toIso(value: Date): string {
  return new Date(value).toISOString();
}

function toIsoOrNull(value: Date | null): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

// Normalize the free-text status column to the known union; anything unexpected
// is treated as 'pending' (never invented into a confirmed/unsubscribed state).
function toStatus(value: string): SubscriberStatus {
  if (value === 'confirmed') return 'confirmed';
  if (value === 'unsubscribed') return 'unsubscribed';
  return 'pending';
}

function mapRow(row: SubscriberRow): Subscriber {
  return {
    id: row.id,
    email: row.email,
    status: toStatus(row.status),
    createdAt: toIso(row.created_at),
    confirmedAt: toIsoOrNull(row.confirmed_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

// subscribe returns the DTO plus the fresh confirm token — the route needs the
// token to send the confirmation email, but the token stays OUT of the DTO.
interface SubscribeResult {
  subscriber: Subscriber;
  confirmToken: string;
}

async function subscribe(email: string): Promise<SubscribeResult> {
  await dbQuery("DELETE FROM subscribers WHERE status = 'pending' AND confirm_expires_at < NOW()");

  const existing = await dbQuery<SubscriberRow>(
    'SELECT * FROM subscribers WHERE LOWER(email) = LOWER($1)',
    [email]
  );

  const confirmToken = uuidv4();
  const confirmExpiresAt = new Date(Date.now() + CONFIRM_TTL_MS).toISOString();

  if (existing.rows.length) {
    const current = existing.rows[0];
    if (toStatus(current.status) === 'confirmed') {
      await dbQuery(
        `UPDATE subscribers
            SET personal_data_consent_at = NOW(), personal_data_consent_version = $2
          WHERE id = $1`,
        [current.id, PERSONAL_DATA_CONSENT_VERSION]
      );
      throw new AppError(HTTP.CONFLICT, 'Вы уже подписаны');
    }
    // pending | unsubscribed → re-issue a fresh confirm token + window, reset to pending.
    const updated = await dbQuery<SubscriberRow>(
      `UPDATE subscribers
         SET status = 'pending', confirm_token = $2, confirm_expires_at = $3, confirmed_at = NULL,
             personal_data_consent_at = NOW(), personal_data_consent_version = $4
       WHERE id = $1
       RETURNING *`,
      [current.id, confirmToken, confirmExpiresAt, PERSONAL_DATA_CONSENT_VERSION]
    );
    return { subscriber: mapRow(updated.rows[0]), confirmToken };
  }

  try {
    const inserted = await dbQuery<SubscriberRow>(
      `INSERT INTO subscribers
         (id, email, status, confirm_token, confirm_expires_at, unsubscribe_token,
          personal_data_consent_at, personal_data_consent_version)
       VALUES ($1, $2, 'pending', $3, $4, $5, NOW(), $6)
       RETURNING *`,
      [uuidv4(), email, confirmToken, confirmExpiresAt, uuidv4(), PERSONAL_DATA_CONSENT_VERSION]
    );
    return { subscriber: mapRow(inserted.rows[0]), confirmToken };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Lost a race with a concurrent subscribe of the same email — treat as already pending.
      throw new AppError(HTTP.CONFLICT, 'Вы уже подписаны');
    }
    throw error;
  }
}

async function confirm(token: string): Promise<Subscriber> {
  const found = await dbQuery<SubscriberRow>('SELECT * FROM subscribers WHERE confirm_token = $1', [
    token,
  ]);
  if (!found.rows.length) {
    throw new AppError(HTTP.NOT_FOUND, 'Ссылка недействительна');
  }

  const row = found.rows[0];
  const expiresAt = row.confirm_expires_at;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    await dbQuery("DELETE FROM subscribers WHERE id = $1 AND status = 'pending'", [row.id]);
    throw new AppError(HTTP.GONE, 'Ссылка устарела, подпишитесь заново');
  }

  // Single-use: null the confirm token so the link can't be replayed.
  const updated = await dbQuery<SubscriberRow>(
    `UPDATE subscribers
       SET status = 'confirmed', confirmed_at = NOW(), confirm_token = NULL, confirm_expires_at = NULL
     WHERE id = $1
     RETURNING *`,
    [row.id]
  );
  return mapRow(updated.rows[0]);
}

interface UnsubscribeResult {
  email: string;
}

async function unsubscribe(token: string): Promise<UnsubscribeResult> {
  const found = await dbQuery<SubscriberRow>(
    'SELECT * FROM subscribers WHERE unsubscribe_token = $1',
    [token]
  );
  if (!found.rows.length) {
    throw new AppError(HTTP.NOT_FOUND, 'Ссылка недействительна');
  }

  // Idempotent: re-running on an already-unsubscribed row is fine.
  const updated = await dbQuery<SubscriberRow>(
    `UPDATE subscribers SET status = 'unsubscribed' WHERE id = $1 RETURNING email`,
    [found.rows[0].id]
  );
  return { email: updated.rows[0].email };
}

interface ConfirmedRecipient {
  email: string;
  unsubscribeToken: string;
}

async function listConfirmed(): Promise<ConfirmedRecipient[]> {
  const result = await dbQuery<{ email: string; unsubscribe_token: string | null }>(
    "SELECT email, unsubscribe_token FROM subscribers WHERE status = 'confirmed'"
  );
  return result.rows.map((row) => ({
    email: row.email,
    unsubscribeToken: row.unsubscribe_token ?? '',
  }));
}

export const subscriberService = { subscribe, confirm, unsubscribe, listConfirmed };
