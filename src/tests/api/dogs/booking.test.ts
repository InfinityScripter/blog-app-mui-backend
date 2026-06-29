import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import adminLoginHandler from '@/src/pages/api/dogs/admin/login';
import adminSlotsHandler from '@/src/pages/api/dogs/admin/slots';
import { dogsBookingService } from '@/src/services/dogs-booking';
import requestsHandler from '@/src/pages/api/dogs/booking/requests';
import clientHandler from '@/src/pages/api/dogs/booking/client/[token]';

jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));

describe('Dogs booking API', () => {
  beforeEach(() => {
    process.env.DOGS_ADMIN_PASSWORD = 'secret';
    process.env.DOGS_ADMIN_SESSION_SECRET = 'session-secret';
  });

  it('logs in admin and creates a slot', async () => {
    const { req: loginReq, res: loginRes } = createMocks({
      method: 'POST',
      body: { password: 'secret' },
    });
    await adminLoginHandler(loginReq, loginRes);
    expect(loginRes._getStatusCode()).toBe(200);
    const loginData = JSON.parse(loginRes._getData());

    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: `Bearer ${loginData.data.token}` },
      body: {
        startsAt: '2027-02-01T09:00:00.000Z',
        endsAt: '2027-02-01T10:00:00.000Z',
      },
    });
    await adminSlotsHandler(req, res);
    expect(res._getStatusCode()).toBe(201);
    const data = JSON.parse(res._getData());
    expect(data.data.slot.startsAt).toBe('2027-02-01T09:00:00.000Z');
  });

  it('creates a booking request and returns client portal by token', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-02-02T09:00:00.000Z',
      endsAt: '2027-02-02T10:00:00.000Z',
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
    expect(res._getStatusCode()).toBe(201);
    const requestData = JSON.parse(res._getData());
    const token = requestData.data.request.client.accessToken;

    const { req: clientReq, res: clientRes } = createMocks({
      method: 'GET',
      query: { token },
    });
    await clientHandler(clientReq, clientRes);
    expect(clientRes._getStatusCode()).toBe(200);
    const clientData = JSON.parse(clientRes._getData());
    expect(clientData.data.requests).toHaveLength(1);
    expect(clientData.data.requests[0].status).toBe('pending');
  });
});
