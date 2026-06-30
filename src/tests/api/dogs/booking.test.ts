import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import adminLoginHandler from '@/src/pages/api/dogs/admin/login';
import adminSlotsHandler from '@/src/pages/api/dogs/admin/slots';
import { dogsBookingService } from '@/src/services/dogs-booking';
import requestsHandler from '@/src/pages/api/dogs/booking/requests';
import clientHandler from '@/src/pages/api/dogs/booking/client/[token]';

jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));

jest.mock('@/src/utils/dogs-email', () => ({
  sendDogsRequestReceived: jest.fn().mockResolvedValue(undefined),
  sendDogsStatusChanged: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/first, import/order
import { sendDogsRequestReceived } from '@/src/utils/dogs-email';

const sendReceivedMock = sendDogsRequestReceived as jest.Mock;

describe('Dogs booking API', () => {
  beforeEach(() => {
    sendReceivedMock.mockClear();
    sendReceivedMock.mockResolvedValue(undefined);
  });

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

  it('rejects a booking request with a malformed email', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-02-03T09:00:00.000Z',
      endsAt: '2027-02-03T10:00:00.000Z',
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        name: 'Анна',
        phone: '+7 900 111 22 33',
        email: 'not-an-email',
        serviceId: 'training',
        slotId: slot!.id,
        source: 'site',
      },
    });
    await requestsHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('accepts a booking request with a valid email', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-02-04T09:00:00.000Z',
      endsAt: '2027-02-04T10:00:00.000Z',
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        name: 'Анна',
        phone: '+7 900 111 22 33',
        email: 'anna@example.com',
        serviceId: 'training',
        slotId: slot!.id,
        source: 'site',
      },
    });
    await requestsHandler(req, res);
    expect(res._getStatusCode()).toBe(201);
    expect(JSON.parse(res._getData()).data.request.client.email).toBe('anna@example.com');
    expect(sendReceivedMock).toHaveBeenCalledTimes(1);
    expect(sendReceivedMock.mock.calls[0][0].email).toBe('anna@example.com');
  });

  it('lowercases the email before storing it', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-02-06T09:00:00.000Z',
      endsAt: '2027-02-06T10:00:00.000Z',
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        name: 'Анна',
        phone: '+7 900 111 22 33',
        email: 'Anna@Example.COM',
        serviceId: 'training',
        slotId: slot!.id,
        source: 'site',
      },
    });
    await requestsHandler(req, res);
    expect(res._getStatusCode()).toBe(201);
    expect(JSON.parse(res._getData()).data.request.client.email).toBe('anna@example.com');
  });

  it('still returns 201 when the request-received email send throws', async () => {
    sendReceivedMock.mockRejectedValue(new Error('smtp down'));
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-02-05T09:00:00.000Z',
      endsAt: '2027-02-05T10:00:00.000Z',
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        name: 'Анна',
        phone: '+7 900 111 22 33',
        email: 'anna@example.com',
        serviceId: 'training',
        slotId: slot!.id,
        source: 'site',
      },
    });
    await requestsHandler(req, res);
    expect(res._getStatusCode()).toBe(201);
  });
});
