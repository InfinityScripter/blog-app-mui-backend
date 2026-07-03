import type {
  DogsSlotsQuery,
  DogsBookingStatus,
  CreateDogsSlotInput,
  CreateDogsBookingRequestInput,
} from '@/src/schemas/dogs-booking';

import crypto from 'crypto';
import uuidv4 from '@/src/utils/uuidv4';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { dogsDbQuery } from '@/src/lib/dogs-db';

type DogsBookingSource = CreateDogsBookingRequestInput['source'];

interface DogsClientRow {
  id: string;
  name: string;
  phone: string;
  phone_normalized: string;
  email: string | null;
  access_token: string;
  telegram_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DogsSlotRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface DogsBookingRequestRow {
  id: string;
  client_id: string;
  slot_id: string;
  service_id: string;
  dog: string;
  comment: string;
  status: DogsBookingStatus;
  source: DogsBookingSource;
  created_at: Date;
  updated_at: Date;
}

interface DogsBookingRequestWithDetailsRow extends DogsBookingRequestRow {
  client_name: string;
  client_phone: string;
  client_email: string | null;
  client_access_token: string;
  starts_at: Date;
  ends_at: Date;
}

function normalizePhone(phone: string) {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return `${hasPlus ? '+' : ''}${digits}`;
}

function toIso(value: Date) {
  return new Date(value).toISOString();
}

function mapSlot(row: DogsSlotRow) {
  return {
    id: row.id,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    isActive: row.is_active,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapClient(row: DogsClientRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    accessToken: row.access_token,
    telegramUserId: row.telegram_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapRequest(row: DogsBookingRequestWithDetailsRow) {
  return {
    id: row.id,
    serviceId: row.service_id,
    dog: row.dog,
    comment: row.comment,
    status: row.status,
    source: row.source,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    client: {
      id: row.client_id,
      name: row.client_name,
      phone: row.client_phone,
      email: row.client_email,
      accessToken: row.client_access_token,
    },
    slot: {
      id: row.slot_id,
      startsAt: toIso(row.starts_at),
      endsAt: toIso(row.ends_at),
    },
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function generateAccessToken() {
  return crypto.randomBytes(32).toString('base64url');
}

async function createClient(input: { name: string; phone: string; email?: string }) {
  const phoneNormalized = normalizePhone(input.phone);
  if (!phoneNormalized || phoneNormalized.length < 5) {
    throw new AppError(HTTP.BAD_REQUEST, 'Invalid phone');
  }

  const existing = await dogsDbQuery<DogsClientRow>(
    'SELECT * FROM dogs_clients WHERE phone_normalized = $1',
    [phoneNormalized]
  );

  if (existing.rows[0]) {
    // Keep the previously stored email if no new one is supplied (COALESCE on
    // the incoming value): a repeat booking without email must not wipe it.
    const updated = await dogsDbQuery<DogsClientRow>(
      `UPDATE dogs_clients
       SET name = $1, phone = $2, email = COALESCE($3, email), updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [input.name, input.phone, input.email ?? null, existing.rows[0].id]
    );
    return updated.rows[0];
  }

  const id = uuidv4();
  const accessToken = generateAccessToken();
  const created = await dogsDbQuery<DogsClientRow>(
    `INSERT INTO dogs_clients (id, name, phone, phone_normalized, email, access_token)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, input.name, input.phone, phoneNormalized, input.email ?? null, accessToken]
  );
  return created.rows[0];
}

async function listAvailableSlots(query: DogsSlotsQuery) {
  const from = query.from ?? new Date().toISOString();
  const to = query.to ?? null;
  const result = await dogsDbQuery<DogsSlotRow>(
    `SELECT s.*
     FROM dogs_booking_slots s
     WHERE s.is_active = TRUE
       AND s.starts_at >= $1
       AND ($2::timestamptz IS NULL OR s.starts_at < $2::timestamptz)
       AND s.id NOT IN (
         SELECT slot_id FROM dogs_booking_requests WHERE status IN ('pending', 'confirmed')
       )
     ORDER BY s.starts_at ASC`,
    [from, to]
  );
  return result.rows.map(mapSlot);
}

async function listAdminSlots() {
  const result = await dogsDbQuery<DogsSlotRow>(
    'SELECT * FROM dogs_booking_slots ORDER BY starts_at DESC'
  );
  return result.rows.map(mapSlot);
}

// Returns the created slot, or null when a slot already exists at this
// startsAt (UNIQUE index → ON CONFLICT DO NOTHING). Lets the caller report
// "skipped" instead of surfacing a 409.
async function createSlot(input: CreateDogsSlotInput) {
  const id = uuidv4();
  const result = await dogsDbQuery<DogsSlotRow>(
    `INSERT INTO dogs_booking_slots (id, starts_at, ends_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (starts_at) DO NOTHING
     RETURNING *`,
    [id, input.startsAt, input.endsAt]
  );
  // Only the row we just inserted carries our generated id; a conflict either
  // returns nothing (real PG) or echoes the existing row (pg-mem) — both → null.
  const inserted = result.rows[0];
  return inserted && inserted.id === id ? mapSlot(inserted) : null;
}

// Inserts a batch of slots, skipping any whose startsAt already exists or is
// duplicated within the batch. Returns only the rows actually inserted so the
// caller can report "added N, skipped M".
async function createSlots(inputs: CreateDogsSlotInput[]) {
  if (inputs.length === 0) {
    return [];
  }

  // Drop duplicate startsAt within the batch first; ON CONFLICT alone cannot
  // resolve two identical keys proposed in the same INSERT statement.
  const seen = new Set<string>();
  const unique = inputs.filter((input) => {
    if (seen.has(input.startsAt)) {
      return false;
    }
    seen.add(input.startsAt);
    return true;
  });

  const insertedIds = new Set<string>();
  const values: unknown[] = [];
  const tuples = unique.map((input, index) => {
    const id = uuidv4();
    insertedIds.add(id);
    const base = index * 3;
    values.push(id, input.startsAt, input.endsAt);
    return `($${base + 1}, $${base + 2}, $${base + 3})`;
  });

  const result = await dogsDbQuery<DogsSlotRow>(
    `INSERT INTO dogs_booking_slots (id, starts_at, ends_at)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (starts_at) DO NOTHING
     RETURNING *`,
    values
  );
  // RETURNING after ON CONFLICT DO NOTHING may echo the pre-existing
  // conflicting row (a pg-mem quirk; harmless on real PG which returns none).
  // Keep only rows that carry one of the ids we generated → true inserts.
  return result.rows.filter((row) => insertedIds.has(row.id)).map(mapSlot);
}

async function updateSlot(slotId: string, patch: { isActive: boolean }) {
  const result = await dogsDbQuery<DogsSlotRow>(
    `UPDATE dogs_booking_slots
     SET is_active = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [patch.isActive, slotId]
  );
  if (!result.rows[0]) {
    throw new AppError(HTTP.NOT_FOUND, 'Slot not found');
  }
  return mapSlot(result.rows[0]);
}

async function deleteSlot(slotId: string) {
  const result = await dogsDbQuery<{ id: string }>(
    'DELETE FROM dogs_booking_slots WHERE id = $1 RETURNING id',
    [slotId]
  );
  if (!result.rows[0]) {
    throw new AppError(HTTP.NOT_FOUND, 'Slot not found');
  }
}

async function getRequestDetails(requestId: string) {
  const result = await dogsDbQuery<DogsBookingRequestWithDetailsRow>(
    `SELECT r.*, c.name AS client_name, c.phone AS client_phone,
            c.email AS client_email, c.access_token AS client_access_token,
            s.starts_at, s.ends_at
     FROM dogs_booking_requests r
     JOIN dogs_clients c ON c.id = r.client_id
     JOIN dogs_booking_slots s ON s.id = r.slot_id
     WHERE r.id = $1`,
    [requestId]
  );
  if (!result.rows[0]) {
    throw new AppError(HTTP.NOT_FOUND, 'Booking request not found');
  }
  return mapRequest(result.rows[0]);
}

async function createRequest(input: CreateDogsBookingRequestInput) {
  const slot = await dogsDbQuery<DogsSlotRow>(
    `SELECT * FROM dogs_booking_slots
     WHERE id = $1 AND is_active = TRUE AND starts_at >= NOW()`,
    [input.slotId]
  );
  if (!slot.rows[0]) {
    throw new AppError(HTTP.NOT_FOUND, 'Slot not found');
  }

  const client = await createClient({
    name: input.name,
    phone: input.phone,
    email: input.email,
  });
  const id = uuidv4();

  try {
    await dogsDbQuery<DogsBookingRequestRow>(
      `INSERT INTO dogs_booking_requests
         (id, client_id, slot_id, service_id, dog, comment, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        client.id,
        input.slotId,
        input.serviceId,
        input.dog ?? '',
        input.comment ?? '',
        input.source,
      ]
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(HTTP.CONFLICT, 'Slot is already reserved');
    }
    throw error;
  }

  return getRequestDetails(id);
}

async function getClientPortal(accessToken: string) {
  const clientResult = await dogsDbQuery<DogsClientRow>(
    'SELECT * FROM dogs_clients WHERE access_token = $1',
    [accessToken]
  );
  const client = clientResult.rows[0];
  if (!client) {
    throw new AppError(HTTP.NOT_FOUND, 'Client not found');
  }

  const requests = await dogsDbQuery<DogsBookingRequestWithDetailsRow>(
    `SELECT r.*, c.name AS client_name, c.phone AS client_phone,
            c.email AS client_email, c.access_token AS client_access_token,
            s.starts_at, s.ends_at
     FROM dogs_booking_requests r
     JOIN dogs_clients c ON c.id = r.client_id
     JOIN dogs_booking_slots s ON s.id = r.slot_id
     WHERE r.client_id = $1
     ORDER BY s.starts_at DESC`,
    [client.id]
  );

  return {
    client: mapClient(client),
    requests: requests.rows.map(mapRequest),
  };
}

async function listAdminBookings() {
  const result = await dogsDbQuery<DogsBookingRequestWithDetailsRow>(
    `SELECT r.*, c.name AS client_name, c.phone AS client_phone,
            c.email AS client_email, c.access_token AS client_access_token,
            s.starts_at, s.ends_at
     FROM dogs_booking_requests r
     JOIN dogs_clients c ON c.id = r.client_id
     JOIN dogs_booking_slots s ON s.id = r.slot_id
     ORDER BY r.created_at DESC`
  );
  return result.rows.map(mapRequest);
}

// Returns the request plus a `changed` flag telling the caller whether this call
// actually transitioned the status. The gate is the atomic `status <> $1` guard:
// a repeated PATCH with the same status updates no row → changed=false, so the
// route can skip re-notifying (idempotent cancelled/confirmed/...). A missing
// request still surfaces as 404 via getRequestDetails below.
async function updateBookingStatus(requestId: string, status: DogsBookingStatus) {
  let changed = true;
  try {
    const result = await dogsDbQuery<{ id: string }>(
      `UPDATE dogs_booking_requests
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND status <> $1
       RETURNING id`,
      [status, requestId]
    );
    if (!result.rows[0]) {
      // Either the request does not exist or it already has this status. The
      // getRequestDetails call below distinguishes them (it throws 404 when the
      // request is genuinely absent); an existing same-status row is a no-op.
      changed = false;
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(HTTP.CONFLICT, 'Slot is already reserved');
    }
    throw error;
  }

  const booking = await getRequestDetails(requestId);
  return { booking, changed };
}

async function deleteRequest(requestId: string) {
  const result = await dogsDbQuery<{ id: string }>(
    'DELETE FROM dogs_booking_requests WHERE id = $1 RETURNING id',
    [requestId]
  );
  if (!result.rows[0]) {
    throw new AppError(HTTP.NOT_FOUND, 'Booking request not found');
  }
}

// Client-initiated cancel. The access token IS the authentication — only the
// client owning that token may cancel, and only a still-active request
// (pending|confirmed). Flipping to 'cancelled' frees the slot via the existing
// active-slot uniqueness rule. Notifications are fired by the route, matching
// updateBookingStatus.
async function cancelClientRequest(accessToken: string, requestId: string) {
  const clientResult = await dogsDbQuery<DogsClientRow>(
    'SELECT * FROM dogs_clients WHERE access_token = $1',
    [accessToken]
  );
  const client = clientResult.rows[0];
  if (!client) {
    throw new AppError(HTTP.NOT_FOUND, 'Client not found');
  }

  // Ownership + active-status guard collapsed into the UPDATE itself, gated on
  // RETURNING, so the check and the write are one atomic statement. This avoids
  // a TOCTOU window where a concurrent cancel re-notifies, or an admin status
  // change (declined/confirmed) made after a separate SELECT is silently
  // overwritten by a blind id-only UPDATE.
  const updated = await dogsDbQuery<DogsBookingRequestRow>(
    `UPDATE dogs_booking_requests
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND client_id = $2 AND status IN ('pending', 'confirmed')
     RETURNING *`,
    [requestId, client.id]
  );

  if (!updated.rows[0]) {
    // Either the request does not belong to this client / does not exist, or it
    // is no longer in a cancellable state. Distinguish so the caller gets a
    // meaningful status without leaking another client's request existence.
    const owned = await dogsDbQuery<{ status: DogsBookingStatus }>(
      'SELECT status FROM dogs_booking_requests WHERE id = $1 AND client_id = $2',
      [requestId, client.id]
    );
    if (!owned.rows[0]) {
      throw new AppError(HTTP.NOT_FOUND, 'Booking request not found');
    }
    throw new AppError(HTTP.CONFLICT, 'Only an active request can be cancelled');
  }

  return getRequestDetails(requestId);
}

async function getClientByTelegramId(telegramUserId: string) {
  const result = await dogsDbQuery<DogsClientRow>(
    'SELECT * FROM dogs_clients WHERE telegram_user_id = $1',
    [telegramUserId]
  );
  return result.rows[0] ? mapClient(result.rows[0]) : null;
}

async function getClientById(clientId: string) {
  const result = await dogsDbQuery<DogsClientRow>('SELECT * FROM dogs_clients WHERE id = $1', [
    clientId,
  ]);
  return result.rows[0] ? mapClient(result.rows[0]) : null;
}

async function linkTelegramClient(accessToken: string, telegramUserId: string) {
  // Re-linking must be idempotent: telegram_user_id is UNIQUE, and one person
  // legitimately books under a second phone/client (another dog, a test
  // request). Without the unlink step the second /start <token> dies on the
  // unique constraint with a 500 in the bot chat (seen live in prod logs).
  await dogsDbQuery(
    `UPDATE dogs_clients
     SET telegram_user_id = NULL, updated_at = NOW()
     WHERE telegram_user_id = $1 AND access_token <> $2`,
    [telegramUserId, accessToken]
  );

  const result = await dogsDbQuery<DogsClientRow>(
    `UPDATE dogs_clients
     SET telegram_user_id = $1, updated_at = NOW()
     WHERE access_token = $2
     RETURNING *`,
    [telegramUserId, accessToken]
  );
  if (!result.rows[0]) {
    throw new AppError(HTTP.NOT_FOUND, 'Client not found');
  }
  return mapClient(result.rows[0]);
}

export const dogsBookingService = {
  cancelClientRequest,
  createRequest,
  createSlot,
  createSlots,
  deleteRequest,
  deleteSlot,
  getClientById,
  getClientByTelegramId,
  getClientPortal,
  getRequestDetails,
  linkTelegramClient,
  listAdminBookings,
  listAdminSlots,
  listAvailableSlots,
  updateBookingStatus,
  updateSlot,
};

export type DogsBookingRequest = Awaited<ReturnType<typeof getRequestDetails>>;
