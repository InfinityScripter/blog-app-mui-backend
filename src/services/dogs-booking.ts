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

async function createClient(input: { name: string; phone: string }) {
  const phoneNormalized = normalizePhone(input.phone);
  if (!phoneNormalized || phoneNormalized.length < 5) {
    throw new AppError(HTTP.BAD_REQUEST, 'Invalid phone');
  }

  const existing = await dogsDbQuery<DogsClientRow>(
    'SELECT * FROM dogs_clients WHERE phone_normalized = $1',
    [phoneNormalized]
  );

  if (existing.rows[0]) {
    const updated = await dogsDbQuery<DogsClientRow>(
      `UPDATE dogs_clients
       SET name = $1, phone = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [input.name, input.phone, existing.rows[0].id]
    );
    return updated.rows[0];
  }

  const id = uuidv4();
  const accessToken = generateAccessToken();
  const created = await dogsDbQuery<DogsClientRow>(
    `INSERT INTO dogs_clients (id, name, phone, phone_normalized, access_token)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, input.name, input.phone, phoneNormalized, accessToken]
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

async function createSlot(input: CreateDogsSlotInput) {
  const id = uuidv4();
  const result = await dogsDbQuery<DogsSlotRow>(
    `INSERT INTO dogs_booking_slots (id, starts_at, ends_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [id, input.startsAt, input.endsAt]
  );
  return mapSlot(result.rows[0]);
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

async function getRequestDetails(requestId: string) {
  const result = await dogsDbQuery<DogsBookingRequestWithDetailsRow>(
    `SELECT r.*, c.name AS client_name, c.phone AS client_phone,
            c.access_token AS client_access_token, s.starts_at, s.ends_at
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

  const client = await createClient({ name: input.name, phone: input.phone });
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
            c.access_token AS client_access_token, s.starts_at, s.ends_at
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
            c.access_token AS client_access_token, s.starts_at, s.ends_at
     FROM dogs_booking_requests r
     JOIN dogs_clients c ON c.id = r.client_id
     JOIN dogs_booking_slots s ON s.id = r.slot_id
     ORDER BY r.created_at DESC`
  );
  return result.rows.map(mapRequest);
}

async function updateBookingStatus(requestId: string, status: DogsBookingStatus) {
  try {
    const result = await dogsDbQuery<DogsBookingRequestRow>(
      `UPDATE dogs_booking_requests
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, requestId]
    );
    if (!result.rows[0]) {
      throw new AppError(HTTP.NOT_FOUND, 'Booking request not found');
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(HTTP.CONFLICT, 'Slot is already reserved');
    }
    throw error;
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

async function linkTelegramClient(accessToken: string, telegramUserId: string) {
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
  createRequest,
  createSlot,
  getClientByTelegramId,
  getClientPortal,
  linkTelegramClient,
  listAdminBookings,
  listAdminSlots,
  listAvailableSlots,
  updateBookingStatus,
  updateSlot,
};

export type DogsBookingRequest = Awaited<ReturnType<typeof getRequestDetails>>;
