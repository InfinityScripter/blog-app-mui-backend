import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import adminLoginHandler from '@/src/pages/api/dogs/admin/login';
import { dogsBookingService } from '@/src/services/dogs-booking';
import slotIdHandler from '@/src/pages/api/dogs/admin/slots/[id]';
import requestsHandler from '@/src/pages/api/dogs/booking/requests';
import slotsBatchHandler from '@/src/pages/api/dogs/admin/slots/batch';
import bookingIdHandler from '@/src/pages/api/dogs/admin/bookings/[id]';

jest.mock('@/src/utils/cors', () => jest.fn(() => Promise.resolve()));

async function adminToken() {
  const { req, res } = createMocks({ method: 'POST', body: { password: 'secret' } });
  await adminLoginHandler(req, res);
  return JSON.parse(res._getData()).data.token as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createBooking() {
  const slot = await dogsBookingService.createSlot({
    startsAt: '2027-05-01T09:00:00.000Z',
    endsAt: '2027-05-01T10:00:00.000Z',
  });
  const { req, res } = createMocks({
    method: 'POST',
    body: {
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    },
  });
  await requestsHandler(req, res);
  return JSON.parse(res._getData()).data.request as { id: string };
}

describe('Dogs admin mutations API', () => {
  beforeEach(() => {
    process.env.DOGS_ADMIN_PASSWORD = 'secret';
    process.env.DOGS_ADMIN_SESSION_SECRET = 'session-secret';
    delete process.env.DOGS_TELEGRAM_BOT_TOKEN;
  });

  it('creates a batch of slots', async () => {
    const token = await adminToken();
    const { req, res } = createMocks({
      method: 'POST',
      headers: auth(token),
      body: {
        slots: [
          { startsAt: '2027-05-02T09:00:00.000Z', endsAt: '2027-05-02T10:00:00.000Z' },
          { startsAt: '2027-05-02T10:00:00.000Z', endsAt: '2027-05-02T11:00:00.000Z' },
        ],
      },
    });
    await slotsBatchHandler(req, res);
    expect(res._getStatusCode()).toBe(201);
    expect(JSON.parse(res._getData()).data.slots).toHaveLength(2);
  });

  it('rejects an empty batch with 400', async () => {
    const token = await adminToken();
    const { req, res } = createMocks({ method: 'POST', headers: auth(token), body: { slots: [] } });
    await slotsBatchHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('requires admin auth for the batch endpoint', async () => {
    const { req, res } = createMocks({ method: 'POST', body: { slots: [] } });
    await slotsBatchHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('deletes a booking request', async () => {
    const token = await adminToken();
    const booking = await createBooking();
    const { req, res } = createMocks({
      method: 'DELETE',
      headers: auth(token),
      query: { id: booking.id },
    });
    await bookingIdHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).success).toBe(true);

    const { req: req2, res: res2 } = createMocks({
      method: 'DELETE',
      headers: auth(token),
      query: { id: booking.id },
    });
    await bookingIdHandler(req2, res2);
    expect(res2._getStatusCode()).toBe(404);
  });

  it('patches a booking status without crashing when the bot is unconfigured', async () => {
    const token = await adminToken();
    const booking = await createBooking();
    const { req, res } = createMocks({
      method: 'PATCH',
      headers: auth(token),
      query: { id: booking.id },
      body: { status: 'confirmed' },
    });
    await bookingIdHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).data.booking.status).toBe('confirmed');
  });

  it('deletes a slot', async () => {
    const token = await adminToken();
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-05-03T09:00:00.000Z',
      endsAt: '2027-05-03T10:00:00.000Z',
    });
    const { req, res } = createMocks({
      method: 'DELETE',
      headers: auth(token),
      query: { id: slot.id },
    });
    await slotIdHandler(req, res);
    expect(res._getStatusCode()).toBe(200);

    const { req: req2, res: res2 } = createMocks({
      method: 'DELETE',
      headers: auth(token),
      query: { id: slot.id },
    });
    await slotIdHandler(req2, res2);
    expect(res2._getStatusCode()).toBe(404);
  });
});
