import '@jest/globals';
import { dogsBookingService } from '@/src/services/dogs-booking';
import {
  handleDogsTelegramUpdate,
  notifyDogsOwnerNewRequest,
  notifyDogsClientStatusChange,
} from '@/src/services/dogs-telegram';

interface TelegramCall {
  url: string;
  body: { chat_id: number | string; text: string };
}

function mockTelegramFetch() {
  const calls: TelegramCall[] = [];
  const fetchMock = jest.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: JSON.parse(init?.body ?? '{}') });
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return calls;
}

describe('dogs telegram service', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.DOGS_TELEGRAM_BOT_TOKEN = 'test-token';
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.DOGS_TELEGRAM_BOT_TOKEN;
    delete process.env.DOGS_CONTACT_TEXT;
    delete process.env.DOGS_OWNER_TELEGRAM_ID;
    jest.restoreAllMocks();
  });

  it('answers /contacts with a Yandex Maps link', async () => {
    const calls = mockTelegramFetch();
    await handleDogsTelegramUpdate({ message: { text: '/contacts', chat: { id: 555 } } });

    expect(calls).toHaveLength(1);
    expect(calls[0].body.text).toContain('Телефон');
    expect(calls[0].body.text).toContain('yandex.ru/maps');
  });

  it('notifies a linked client when status changes', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-01T09:00:00.000Z',
      endsAt: '2027-06-01T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 444 55 66',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });
    await dogsBookingService.linkTelegramClient(request.client.accessToken, '987654');

    const calls = mockTelegramFetch();
    const { booking } = await dogsBookingService.updateBookingStatus(request.id, 'confirmed');
    await notifyDogsClientStatusChange(booking);

    expect(calls).toHaveLength(1);
    expect(String(calls[0].body.chat_id)).toBe('987654');
    expect(calls[0].body.text).toContain('подтверждена');
  });

  it('does not notify an unlinked client', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-02T09:00:00.000Z',
      endsAt: '2027-06-02T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Пётр',
      phone: '+7 900 555 66 77',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const calls = mockTelegramFetch();
    const { booking } = await dogsBookingService.updateBookingStatus(request.id, 'declined');
    await notifyDogsClientStatusChange(booking);

    expect(calls).toHaveLength(0);
  });

  it('notifies every owner when DOGS_OWNER_TELEGRAM_ID has multiple comma-separated ids', async () => {
    process.env.DOGS_OWNER_TELEGRAM_ID = '111, 222';
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-03T09:00:00.000Z',
      endsAt: '2027-06-03T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Олег',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const calls = mockTelegramFetch();
    await notifyDogsOwnerNewRequest(request);

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => String(c.body.chat_id)).sort()).toEqual(['111', '222']);
  });

  it('notifies a single owner when DOGS_OWNER_TELEGRAM_ID has one id', async () => {
    process.env.DOGS_OWNER_TELEGRAM_ID = '111';
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-04T09:00:00.000Z',
      endsAt: '2027-06-04T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Инна',
      phone: '+7 900 222 33 44',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const calls = mockTelegramFetch();
    await notifyDogsOwnerNewRequest(request);

    expect(calls).toHaveLength(1);
    expect(String(calls[0].body.chat_id)).toBe('111');
  });

  it('does not notify anyone when DOGS_OWNER_TELEGRAM_ID is unset', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-05T09:00:00.000Z',
      endsAt: '2027-06-05T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Юрий',
      phone: '+7 900 333 44 55',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const calls = mockTelegramFetch();
    await notifyDogsOwnerNewRequest(request);

    expect(calls).toHaveLength(0);
  });
});
