import type { DogsBookingRequest } from '@/src/services/dogs-booking';
import type { PushSubscription as WebPushSubscription } from 'web-push';
import type { DogsPushSubscriptionInput } from '@/src/schemas/dogs-booking';

import webpush from 'web-push';
import uuidv4 from '@/src/utils/uuidv4';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { dogsDbQuery } from '@/src/lib/dogs-db';
import { formatDogsClock, formatDogsDateTime, formatDogsDayLabel } from '@/src/utils/dogs-format';

interface DogsPushSubscriptionRow {
  id: string;
  client_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: Date;
}

// Payload delivered to the service worker's `push` handler on the client.
export interface DogsPushPayload {
  title: string;
  body: string;
  url: string;
}

// Per-status headline mirrors the Telegram STATUS_MESSAGES wording so the
// client sees the same phrasing across channels. Falls back to `pending`.
const STATUS_TITLES: Record<string, string> = {
  confirmed: '✅ Заявка подтверждена',
  declined: '❌ Заявку отклонили',
  cancelled: 'ℹ️ Заявка отменена',
  pending: 'ℹ️ Статус заявки обновлён',
};

function getSiteUrl() {
  return (process.env.DOGS_SITE_URL || 'https://dogs-teacher.vercel.app').replace(/\/$/, '');
}

function getVapidPublicKey(): string | null {
  return process.env.DOGS_VAPID_PUBLIC_KEY || null;
}

function getVapidPrivateKey(): string | null {
  return process.env.DOGS_VAPID_PRIVATE_KEY || null;
}

function getVapidSubject() {
  return process.env.DOGS_VAPID_SUBJECT || 'mailto:admin@example.com';
}

// True only when both VAPID keys are present. Every notify path short-circuits
// on this so the service is a silent no-op until keys are configured.
function isConfigured(): boolean {
  return Boolean(getVapidPublicKey() && getVapidPrivateKey());
}

// setVapidDetails must run before sendNotification, but calling it at module
// load would throw when keys are absent (breaks import/tests). Apply it lazily
// and only once per process. Guarded by isConfigured() at the call site.
let vapidConfigured = false;

function ensureVapidDetails() {
  if (vapidConfigured) {
    return;
  }
  const publicKey = getVapidPublicKey();
  const privateKey = getVapidPrivateKey();
  if (!publicKey || !privateKey) {
    return;
  }
  webpush.setVapidDetails(getVapidSubject(), publicKey, privateKey);
  vapidConfigured = true;
}

async function resolveClientId(accessToken: string) {
  const result = await dogsDbQuery<{ id: string }>(
    'SELECT id FROM dogs_clients WHERE access_token = $1',
    [accessToken]
  );
  const client = result.rows[0];
  if (!client) {
    throw new AppError(HTTP.NOT_FOUND, 'Client not found');
  }
  return client.id;
}

// Upsert on the unique endpoint: re-subscribing the same browser (possibly for a
// different client after a device is shared) refreshes the owner and keys rather
// than erroring on the UNIQUE constraint.
async function saveSubscription(accessToken: string, subscription: DogsPushSubscriptionInput) {
  const clientId = await resolveClientId(accessToken);
  const id = uuidv4();
  await dogsDbQuery(
    `INSERT INTO dogs_push_subscriptions (id, client_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET client_id = EXCLUDED.client_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth`,
    [id, clientId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
  );
  return { success: true };
}

// Idempotent: deletes the client's subscription for this endpoint. The
// client_id sub-select ensures a client can only drop its own subscription; a
// missing row is not an error.
async function deleteSubscription(accessToken: string, endpoint: string) {
  await dogsDbQuery(
    `DELETE FROM dogs_push_subscriptions
     WHERE endpoint = $1
       AND client_id = (SELECT id FROM dogs_clients WHERE access_token = $2)`,
    [endpoint, accessToken]
  );
  return { success: true };
}

async function deleteSubscriptionByEndpoint(endpoint: string) {
  await dogsDbQuery('DELETE FROM dogs_push_subscriptions WHERE endpoint = $1', [endpoint]);
}

function getPushStatusCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error as { statusCode?: unknown };
    return typeof statusCode === 'number' ? statusCode : null;
  }
  return null;
}

function toWebPushSubscription(row: DogsPushSubscriptionRow): WebPushSubscription {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

// Delivers one payload to every subscription of the given client. No-op unless
// both VAPID keys are set. Dead subscriptions (404 Not Found / 410 Gone from
// the push service) are pruned so the table self-heals.
async function pushToClient(clientId: string, payload: DogsPushPayload) {
  if (!isConfigured()) {
    return;
  }
  ensureVapidDetails();

  const subscriptions = await dogsDbQuery<DogsPushSubscriptionRow>(
    'SELECT * FROM dogs_push_subscriptions WHERE client_id = $1',
    [clientId]
  );
  if (!subscriptions.rows.length) {
    return;
  }

  const body = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.rows.map(async (row) => {
      try {
        await webpush.sendNotification(toWebPushSubscription(row), body);
      } catch (error) {
        const statusCode = getPushStatusCode(error);
        if (statusCode === HTTP.NOT_FOUND || statusCode === HTTP.GONE) {
          // Subscription is gone on the push service; drop it so we stop trying.
          await deleteSubscriptionByEndpoint(row.endpoint);
          return;
        }
        throw error;
      }
    })
  );
}

function describeLesson(request: DogsBookingRequest) {
  const when = formatDogsDateTime(request.slot.startsAt);
  return request.dog ? `${when} · ${request.dog}` : when;
}

// Push every subscription belonging to the request's client with the status
// update.
async function notifyClientStatusChange(request: DogsBookingRequest) {
  const title = STATUS_TITLES[request.status] ?? STATUS_TITLES.pending;
  await pushToClient(request.client.id, {
    title,
    body: describeLesson(request),
    url: `${getSiteUrl()}/booking/client/${request.client.accessToken}`,
  });
}

// Reminder for a confirmed lesson within the next ~day. Fired by the reminder
// scheduler (src/services/dogs-reminders.ts), at most once per request.
async function notifyClientReminder(request: DogsBookingRequest) {
  const dayLabel = formatDogsDayLabel(request.slot.startsAt);
  const clock = formatDogsClock(request.slot.startsAt);
  const whenShort = dayLabel ? `${dayLabel} в ${clock}` : formatDogsDateTime(request.slot.startsAt);
  await pushToClient(request.client.id, {
    title: '🔔 Скоро занятие',
    body: `Ждём вас ${whenShort} в центре «DOG-CITY»${request.dog ? ` · ${request.dog}` : ''}`,
    url: `${getSiteUrl()}/booking/client/${request.client.accessToken}`,
  });
}

export const dogsWebPushService = {
  deleteSubscription,
  getVapidPublicKey,
  isConfigured,
  notifyClientReminder,
  notifyClientStatusChange,
  saveSubscription,
};
