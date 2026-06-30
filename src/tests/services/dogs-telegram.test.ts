import '@jest/globals';
import { dogsBookingService } from '@/src/services/dogs-booking';
import {
  handleDogsTelegramUpdate,
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
});
