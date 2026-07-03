import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { dogsDbQuery } from '@/src/lib/dogs-db';
import { HTTP_METHOD } from '@/src/constants/http';
import { dogsBookingService } from '@/src/services/dogs-booking';

// VAPID keys must exist before the service reads them (it reads lazily at call
// time, but set them here so isConfigured() is true throughout). setVapidDetails
// is mocked below, so the keys only need to be non-empty, not cryptographically
// valid.
process.env.DOGS_VAPID_PUBLIC_KEY = 'test-public-key';
process.env.DOGS_VAPID_PRIVATE_KEY = 'test-private-key';
process.env.DOGS_VAPID_SUBJECT = 'mailto:test@example.com';

// Mock web-push so no real notification is sent and we can assert send calls +
// simulate push-service errors (410 Gone) for dead-subscription cleanup.
jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn().mockResolvedValue({ statusCode: 201 }),
  },
}));

jest.mock('@/src/utils/cors', () => jest.fn(() => Promise.resolve()));

jest.mock('@/src/utils/dogs-email', () => ({
  sendDogsRequestReceived: jest.fn().mockResolvedValue(undefined),
  sendDogsStatusChanged: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/src/services/dogs-telegram', () => ({
  notifyDogsClientStatusChange: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/first, import/order
import webpush from 'web-push';
// eslint-disable-next-line import/first, import/order
import adminLoginHandler from '@/src/pages/api/dogs/admin/login';
// eslint-disable-next-line import/first, import/order
import subscribeHandler from '@/src/pages/api/dogs/push/subscribe';
// eslint-disable-next-line import/first, import/order
import unsubscribeHandler from '@/src/pages/api/dogs/push/unsubscribe';
// eslint-disable-next-line import/first, import/order
import bookingIdHandler from '@/src/pages/api/dogs/admin/bookings/[id]';
// eslint-disable-next-line import/first, import/order
import vapidKeyHandler from '@/src/pages/api/dogs/push/vapid-public-key';

const sendNotificationMock = webpush.sendNotification as jest.Mock;

const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/sub/abc123',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
};

// The route fires notifyClientStatusChange fire-and-forget (.catch), so the
// send happens on a microtask after the handler resolves. Flush the queue so
// assertions see the completed send.
function flushPromises() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function adminToken() {
  const { req, res } = createMocks({ method: HTTP_METHOD.POST, body: { password: 'secret' } });
  await adminLoginHandler(req, res);
  return JSON.parse(res._getData()).data.token as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createBookingRequest() {
  const slot = await dogsBookingService.createSlot({
    startsAt: '2027-09-01T09:00:00.000Z',
    endsAt: '2027-09-01T10:00:00.000Z',
  });
  return dogsBookingService.createRequest({
    name: 'Анна',
    phone: '+7 900 111 22 33',
    email: 'anna@example.com',
    serviceId: 'training',
    slotId: slot!.id,
    source: 'site',
  });
}

async function subscribe(accessToken: string, subscription = SUBSCRIPTION) {
  const { req, res } = createMocks({
    method: HTTP_METHOD.POST,
    body: { accessToken, subscription },
  });
  await subscribeHandler(req, res);
  return res;
}

describe('Dogs web-push API', () => {
  beforeEach(() => {
    process.env.DOGS_ADMIN_PASSWORD = 'secret';
    process.env.DOGS_ADMIN_SESSION_SECRET = 'session-secret';
    delete process.env.DOGS_TELEGRAM_BOT_TOKEN;
    sendNotificationMock.mockClear();
    sendNotificationMock.mockResolvedValue({ statusCode: 201 });
  });

  it('stores a subscription for the owning client', async () => {
    const request = await createBookingRequest();

    const res = await subscribe(request.client.accessToken);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).success).toBe(true);

    const rows = await dogsDbQuery(
      'SELECT client_id, endpoint FROM dogs_push_subscriptions WHERE endpoint = $1',
      [SUBSCRIPTION.endpoint]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].client_id).toBe(request.client.id);
  });

  it('upserts on a repeated subscribe for the same endpoint', async () => {
    const request = await createBookingRequest();
    await subscribe(request.client.accessToken);
    await subscribe(request.client.accessToken, {
      ...SUBSCRIPTION,
      keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
    });

    const rows = await dogsDbQuery(
      'SELECT p256dh, auth FROM dogs_push_subscriptions WHERE endpoint = $1',
      [SUBSCRIPTION.endpoint]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].p256dh).toBe('new-p256dh');
    expect(rows.rows[0].auth).toBe('new-auth');
  });

  it('returns 404 when subscribing with an unknown access token', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { accessToken: 'x'.repeat(40), subscription: SUBSCRIPTION },
    });
    await subscribeHandler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });

  it('unsubscribes the client subscription by endpoint', async () => {
    const request = await createBookingRequest();
    await subscribe(request.client.accessToken);

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { accessToken: request.client.accessToken, endpoint: SUBSCRIPTION.endpoint },
    });
    await unsubscribeHandler(req, res);
    expect(res._getStatusCode()).toBe(200);

    const rows = await dogsDbQuery('SELECT id FROM dogs_push_subscriptions WHERE endpoint = $1', [
      SUBSCRIPTION.endpoint,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('unsubscribe is idempotent when no subscription exists', async () => {
    const request = await createBookingRequest();
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { accessToken: request.client.accessToken, endpoint: SUBSCRIPTION.endpoint },
    });
    await unsubscribeHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  it('returns the VAPID public key when configured', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET });
    await vapidKeyHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).data.publicKey).toBe('test-public-key');
  });

  it('returns a null VAPID public key when the key is unset', async () => {
    const original = process.env.DOGS_VAPID_PUBLIC_KEY;
    delete process.env.DOGS_VAPID_PUBLIC_KEY;
    try {
      const { req, res } = createMocks({ method: HTTP_METHOD.GET });
      await vapidKeyHandler(req, res);
      expect(res._getStatusCode()).toBe(200);
      expect(JSON.parse(res._getData()).data.publicKey).toBeNull();
    } finally {
      process.env.DOGS_VAPID_PUBLIC_KEY = original;
    }
  });

  it('sends a push notification to the subscribed client on a status PATCH', async () => {
    const request = await createBookingRequest();
    await subscribe(request.client.accessToken);

    const token = await adminToken();
    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      headers: auth(token),
      query: { id: request.id },
      body: { status: 'confirmed' },
    });
    await bookingIdHandler(req, res);
    await flushPromises();

    expect(res._getStatusCode()).toBe(200);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [sub, payload] = sendNotificationMock.mock.calls[0];
    expect(sub.endpoint).toBe(SUBSCRIPTION.endpoint);
    expect(JSON.parse(payload).title).toContain('подтверждена');
  });

  it('prunes a dead subscription when the push service returns 410 Gone', async () => {
    const request = await createBookingRequest();
    await subscribe(request.client.accessToken);
    sendNotificationMock.mockRejectedValue({ statusCode: 410 });

    const token = await adminToken();
    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      headers: auth(token),
      query: { id: request.id },
      body: { status: 'declined' },
    });
    await bookingIdHandler(req, res);
    await flushPromises();

    expect(res._getStatusCode()).toBe(200);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const rows = await dogsDbQuery('SELECT id FROM dogs_push_subscriptions WHERE endpoint = $1', [
      SUBSCRIPTION.endpoint,
    ]);
    expect(rows.rows).toHaveLength(0);
  });
});
