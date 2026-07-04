import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import { dogsBookingService } from '@/src/services/dogs-booking';

jest.mock('@/src/utils/dogs-email', () => ({
  sendDogsRequestReceived: jest.fn().mockResolvedValue(undefined),
  sendDogsStatusChanged: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/src/services/dogs-telegram', () => ({
  notifyDogsOwnerNewRequest: jest.fn().mockResolvedValue(undefined),
  notifyDogsClientStatusChange: jest.fn().mockResolvedValue(undefined),
  notifyDogsOwnerClientCancelled: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/first, import/order
import { sendDogsStatusChanged } from '@/src/utils/dogs-email';
// eslint-disable-next-line import/first, import/order
import { notifyDogsOwnerClientCancelled } from '@/src/services/dogs-telegram';
// eslint-disable-next-line import/first, import/order
import cancelHandler from '@/src/pages/api/dogs/booking/client/[token]/cancel';

const sendStatusMock = sendDogsStatusChanged as jest.Mock;
const notifyOwnerMock = notifyDogsOwnerClientCancelled as jest.Mock;

async function createBooking() {
  const slot = await dogsBookingService.createSlot({
    startsAt: '2027-08-01T09:00:00.000Z',
    endsAt: '2027-08-01T10:00:00.000Z',
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

describe('Dogs client cancel API', () => {
  beforeEach(() => {
    sendStatusMock.mockClear();
    sendStatusMock.mockResolvedValue(undefined);
    notifyOwnerMock.mockClear();
    notifyOwnerMock.mockResolvedValue(undefined);
  });

  it('cancels the request for the owning token and notifies owner + client', async () => {
    const request = await createBooking();

    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      query: { token: request.client.accessToken },
      body: { requestId: request.id },
    });
    await cancelHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).data.booking.status).toBe('cancelled');
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
    expect(sendStatusMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the token does not own the request', async () => {
    const request = await createBooking();
    const otherSlot = await dogsBookingService.createSlot({
      startsAt: '2027-08-01T11:00:00.000Z',
      endsAt: '2027-08-01T12:00:00.000Z',
    });
    const other = await dogsBookingService.createRequest({
      name: 'Пётр',
      phone: '+7 900 222 33 44',
      serviceId: 'training',
      slotId: otherSlot!.id,
      source: 'site',
    });

    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      query: { token: other.client.accessToken },
      body: { requestId: request.id },
    });
    await cancelHandler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });

  it('rejects a non-PATCH method', async () => {
    const request = await createBooking();
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { token: request.client.accessToken },
      body: { requestId: request.id },
    });
    await cancelHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('still returns 200 when client email notification throws', async () => {
    sendStatusMock.mockRejectedValue(new Error('smtp down'));
    const request = await createBooking();
    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      query: { token: request.client.accessToken },
      body: { requestId: request.id },
    });
    await cancelHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });
});
